Object.defineProperty(exports, "__esModule", { value: true });

var express = require('express'),
    builder = require('botbuilder'),
    needle = require('needle'),
    ffmpeg = require('fluent-ffmpeg'),
    speechService = require('./speech-service.js'),
    cognitiveservices = require('botbuilder-cognitiveservices'),
    handoff_1 = require("./handoff"),
    commands_1 = require("./commands"),
    instrumentation = require('botbuilder-instrumentation');

const server = express();
server.listen(process.env.port || process.env.PORT || 3978, '::', () => {
    console.log('Server Up');
});

// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});

// Initialize a bot
var bot = new builder.UniversalBot(connector);

// Listen for messages from users 
server.post('/api/messages', connector.listen());

// Create endpoint for agent / call center
server.use('/webchat', express.static('public'));

// LUIS Natural Language Processing
var luisrecognizer = new builder.LuisRecognizer(process.env.LUIS_URL);
bot.recognizer(luisrecognizer);

// QnA API
var qnarecognizer = new cognitiveservices.QnAMakerRecognizer({
    knowledgeBaseId: process.env.QNA_KNOWLEDGEBASE,
    subscriptionKey: process.env.QNA_KEY
});
bot.recognizer(qnarecognizer);

//=========================================================
// Bot Instrumentation
//=========================================================

// Setting up advanced instrumentation
let logging = new instrumentation.BotFrameworkInstrumentation({
    instrumentationKey: "fff37777-2f10-49a3-a9a5-4573228eb921",
    sentiments: {
        key: process.env.SENTIMENT_KEY,
    }
});
logging.monitor(bot, luisrecognizer);

//=========================================================
// Bots Global Actions
//=========================================================

bot.endConversationAction('goodbye', 'Goodbye :)', { matches: /^goodbye/i });
bot.beginDialogAction('reset', '/reset', { matches: /^reset/i });

//=========================================================
// Bot Human Handoff
//=========================================================

// replace this function with custom login/verification for agents
const isAgent = (session) => session.message.user.name.startsWith("Agent");
const handoff = new handoff_1.Handoff(bot, isAgent);

//=========================================================
// Bot Start
//=========================================================

// Send welcome when conversation with bot is started, by initiating the root dialog
bot.on('conversationUpdate', function (message) {
    if (message.membersAdded) {
        message.membersAdded.forEach(function (identity) {
            if (identity.id === message.address.bot.id) {
                bot.beginDialog(message.address, '/welcome');
            }
        });
    }
});

bot.dialog('/welcome', function (session) {
    session.endDialog("Hi %s, How can I help you?", session.message.user.name.split(" ")[0]);
});

//=========================================================
// Bots Middleware
//=========================================================

//var client = EventHubClient.fromConnectionString(process.env.EVENTHUB_URL, 'mshkchatbot');

bot.use({
    botbuilder: [function (session, next) {
        if (hasAudioAttachment(session)) {
            getAudioStreamFromMessage(session.message, function (stream) {
                speechService.getTextFromAudioStream(stream)
                    .then(function (text) {
                        session.message.text = text;
                        next();
                    })
                    .catch(function (error) {
                        console.error(error);
                        next();
                    });
            });
        } else {
            next();
        }
    },
        function (session, next) {
            console.log(session.message.text);
            //client.open()
            //    .then(function () {
            //        return client.createSender();
            //    })
            //    .then(function (tx) {
            //        tx.on('errorReceived', function (err) { console.log(err); });
            //        tx.send({    
            //            contents: session.message.text, time: new Date().toISOString() }, 'my-pk');
            //    });
            next();
        }
    ]
},commands_1.commandsMiddleware(handoff), handoff.routingMiddleware());

//=========================================================
// Bot Initial Dialog Setup
//=========================================================
bot.dialog('/qna', function (session, args) {
    var answerEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'answer');
    session.endDialog(answerEntity.entity);

    // Hook into the result function of QNA to extract relevant data for logging.
    logging.trackQNAEvent(session, session.message.text, args.intent.answers[0].questions[0], answerEntity.entity, answerEntity.score);
}).triggerAction({
    matches: 'qna',
    intentThreshold: 0.50
});

bot.dialog('/None', function (session) {
    session.sendTyping();
    session.send("Sorry %s, I can't help you with that. Please wait while I connect you to somebody who can :)", session.message.user.name.split(" ")[0]);

    const conversation = handoff.getConversation({ customerConversationId: session.message.address.conversation.id }, session.message.address);
    if (conversation.state == handoff_1.ConversationState.Bot) {
        handoff.addToTranscript({ customerConversationId: conversation.customer.conversation.id }, session.message.text);
        handoff.queueCustomerForAgent({ customerConversationId: conversation.customer.conversation.id });
    }     
}).triggerAction({
    matches: 'None'
    });

bot.dialog('/', function (session) {
    session.sendTyping();
    session.send("Sorry %s, I can't help you with that. Please wait while I connect you to somebody who can :)", session.message.user.name.split(" ")[0]);

    const conversation = handoff.getConversation({ customerConversationId: session.message.address.conversation.id }, session.message.address);
    if (conversation.state == handoff_1.ConversationState.Bot) {
        handoff.addToTranscript({ customerConversationId: conversation.customer.conversation.id }, session.message.text);
        handoff.queueCustomerForAgent({ customerConversationId: conversation.customer.conversation.id });
    }    
});

//=========================================================
// LUIS Dialogs
//=========================================================

bot.dialog('/Specs', function (session, args) {
    // retrieve hotel name from matched entities
    var deviceEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'device');
    if (deviceEntity) {
        session.send('Looking for specifications of \'%s\'...', deviceEntity.entity);
        session.endDialog('Dimensions: 11.5" x 7.9" x 0.33" (292 mm x 201 mm x 8.5 mm)\nDisplay	Screen: 12.3" PixelSense Display\nResolution: 2736 x 1824 (267 PPI)\nTouch: 10 point multi- touch\nMemory: 4GB, 8GB, or 16GB RAM\nProcessor: Intel Core 7th- generation m3, i5, or i7\nBattery Life: Up to 13.5 hours of video playback\nGraphics: Intel HD Graphics 615 (m3), Intel HD Graphics 620 (i5), Intel Iris Plus Graphics 640 (i7)');
    }
}).triggerAction({
    matches: 'Specs',
    intentThreshold: 0.50
    });

var preference = [0, 0, 0, 0, 0];

bot.dialog('/choose', [
    function (session) {
        session.sendTyping();
        session.send("Sure, just tell me a few things and I can come up with a suggestion for you :)");
        preference = [0, 0, 0, 0, 0];
        session.sendTyping();
        builder.Prompts.choice(session, "Are you looking for a device that lets you work anywhere on the go?", "Yes|No", { listStyle: builder.ListStyle.button });
    },
    function (session, results) {
        var choice = [0, 0, 0, 0, 0];
        if (results.response.entity == 'Yes') {
            choice = [10, 10, 10, 10, 0];
        }
        else if (results.response.entity == 'No'){
            choice = [0, 0, 0, 0, 100];
        }
        preference = sumArrayElements(preference, choice);

        session.sendTyping();
        builder.Prompts.choice(session, "What is the most important feature to you in a laptop?", "Versatility|Power|Don'tCare", { listStyle: builder.ListStyle.button });
    },
    function (session, results) {
        var choice = [0, 0, 0, 0, 0];
        if (results.response.entity == 'Versatility') {
            choice = [0, 10, 0, 0, 0];
        }
        else if (results.response.entity == 'Power') {
            choice = [0, 0, 10, 15, 0];
        }
        else if (results.response.entity == 'Don\'tCare') {
            choice = [10, 0, 10, 10, 0];
        }
        preference = sumArrayElements(preference, choice);

        session.sendTyping();
        builder.Prompts.choice(session, "Is it important that you have a lightweight device?", "Yes|No", { listStyle: builder.ListStyle.button });
    },
    function (session, results) {
        var choice = [0, 0, 0, 0, 0];
        if (results.response.entity == 'Yes') {
            choice = [50, 50, 20, 10, 0];
        }
        else if (results.response.entity == 'No') {
            choice = [20, 20, 40, 40, 0];
        }
        preference = sumArrayElements(preference, choice);

        session.sendTyping();
        builder.Prompts.choice(session, "What screen size do you prefer?", "12.3\"|13.5\"", { listStyle: builder.ListStyle.button });
    },
    function (session, results) {
        var choice = [0, 0, 0, 0, 0];
        if (results.response.entity == '12.3\"') {
            choice = [0, 30, 0, 0, 0];
        }
        else if (results.response.entity == '13.5\"') {
            choice = [20, 0, 20, 20, 0];
        }
        preference = sumArrayElements(preference, choice);

        session.sendTyping();
        builder.Prompts.choice(session, "Is long battery life important?", "Yes|No", { listStyle: builder.ListStyle.button });
    },
    function (session, results) {
        var choice = [0, 0, 0, 0, 0];
        if (results.response.entity == 'Yes') {
            choice = [60, 10, 20, 50, 0];
        }
        else if (results.response.entity == 'No') {
            choice = [20, 20, 30, 20, 0];
        }
        preference = sumArrayElements(preference, choice);

        session.sendTyping();
        session.send("Give me a second while I think of the best device for you...");

        var devices = [
            new builder.Message(session).attachments([
                new builder.HeroCard(session)
                    .title("Surface Laptop")
                    .text("Surface Laptop elevates design and performance to an artful blend of luxurious touches, ease of use, discreetly hidden Omnisonic Speakers, and a brilliant interactive touchscreen.")
                    .images([
                        builder.CardImage.create(session, "https://c.s-microsoft.com/en-us/CMSImages/Surface_Business_HMC_SL_V1.jpg?version=eb6d6622-8b38-14e5-e5ac-f511e4567e62")
                    ])
                    .buttons([
                        builder.CardAction.openUrl(session, 'https://www.microsoftstore.com.hk/product/surface-laptop', 'Buy Now')
                    ])
            ]),
            new builder.Message(session).attachments([
                new builder.HeroCard(session)
                    .title("Surface Pro")
                    .text("Now better than ever, Surface Pro combines the best of a laptop, tablet, and studio � with a 20% performance boost from the 7th-generation Intel� Core� processor, plus longer battery life of up to 13.5 hours.")
                    .images([
                        builder.CardImage.create(session, "https://c.s-microsoft.com/en-us/CMSImages/Surface_Business_HMC_J_EN-US_V1.jpg?version=5fb8f316-8ec0-e366-e515-84f9fc5f0a98")
                    ])
                    .buttons([
                        builder.CardAction.openUrl(session, 'https://www.microsoftstore.com.hk/product/surface-pro', 'Buy Now')
                    ])
            ]),
            new builder.Message(session).attachments([
                new builder.HeroCard(session)
                    .title("Surface Book")
                    .text("Surface Book is built for extreme performance, giving you lightning fast access to programs, videos, and music.")
                    .images([
                        builder.CardImage.create(session, "https://c.s-microsoft.com/en-us/CMSImages/Surface_Business_HMC_Recommend_Book_V1.jpg?version=8af31a91-4688-a378-466c-01c73a9095bd")
                    ])
                    .buttons([
                        builder.CardAction.openUrl(session, 'https://www.microsoftstore.com.hk/product/surfacebook', 'Buy Now')
                    ])
            ]),
            new builder.Message(session).attachments([
                new builder.HeroCard(session)
                    .title("Surface Book with Performance Base")
                    .text("Surface Book is built for extreme performance, giving you lightning fast access to programs, videos, and music.")
                    .images([
                        builder.CardImage.create(session, "https://upload.wikimedia.org/wikipedia/en/thumb/2/2a/PikePlaceMarket.jpg/320px-PikePlaceMarket.jpg")
                    ])
                    .buttons([
                        builder.CardAction.openUrl(session, 'https://www.microsoftstore.com.hk/product/Surface-Book-with-Performance-Base', 'Buy Now')
                    ])
            ]),
            new builder.Message(session).attachments([
                new builder.HeroCard(session)
                    .title("Surface Studio")
                    .text("Turn your desk into a Studio. Designed for the creative process, the 28� PixelSense� Display gives you a huge canvas for all kinds of work.")
                    .images([
                        builder.CardImage.create(session, "https://c.s-microsoft.com/en-us/CMSImages/Surface_Business_HMC_Recommend_Studio_V1.jpg?version=fe4be77e-4a26-a2ca-5a87-b26ff1853e0b")
                    ])
                    .buttons([
                        builder.CardAction.openUrl(session, 'https://www.microsoftstore.com.hk/product/surface-studio', 'Buy Now')
                    ])
            ])];

        session.sendTyping();
        session.send("I think this one will be best for you :)");

        session.sendTyping();
        session.endDialog(devices[preference.indexOf(Math.max.apply(null, preference))]);
    }
]).triggerAction({
    matches: 'choose',
    intentThreshold: 0.50
    });

bot.dialog('/thanks', function (session, args) {
    session.sendTyping();
    session.endDialog('My pleasure :)');
}).triggerAction({
    matches: 'thanks',
    intentThreshold: 0.50
    });

bot.dialog('/greeting', function (session, args) {
    session.sendTyping();
    session.endDialog('Hi there %s! :)', session.message.user.name.split(" ")[0]);
}).triggerAction({
    matches: 'greeting',
    intentThreshold: 0.50
});
//=========================================================
// Utilities
//=========================================================

function sumArrayElements() {
    var arrays = arguments, results = [],
        count = arrays[0].length, L = arrays.length,
        sum, next = 0, i;
    while (next < count) {
        sum = 0, i = 0;
        while (i < L) {
            sum += Number(arrays[i++][next]);
        }
        results[next++] = sum;
    }
    return results;
}

function hasAudioAttachment(session) {
    if (session.message.attachments) {
        return session.message.attachments.length > 0 &&
            (session.message.attachments[0].contentType === 'audio/wav' ||
                session.message.attachments[0].contentType === 'application/octet-stream' || session.message.attachments[0].contentType === 'audio/x-m4a' || session.message.attachments[0].contentType === 'audio/aac' || session.message.attachments[0].contentType === 'audio/vnd.dlna.adts');
    }
}

function getAudioStreamFromMessage(message, cb) {
    var headers = {};
    var attachment = message.attachments[0];
    if (checkRequiresToken(message)) {
        // The Skype attachment URLs are secured by JwtToken,
        // you should set the JwtToken of your bot as the authorization header for the GET request your bot initiates to fetch the image.
        // https://github.com/Microsoft/BotBuilder/issues/662
        connector.getAccessToken(function (error, token) {
            var tok = token;
            headers['Authorization'] = 'Bearer ' + token;
            headers['Content-Type'] = 'application/octet-stream';
        });
    }
    if (attachment.contentType === 'audio/x-m4a' || attachment.contentType === 'audio/aac' || attachment.contentType === 'audio/vnd.dlna.adts') {
        headers['Content-Type'] = attachment.contentType;
        var original = needle.get(attachment.contentUrl, { headers: headers, decode: false });
        original.on('finish', function () {
            var command = ffmpeg(original).toFormat('wav');
            var converted = command.pipe();
            command
                .on('error', function (err) {
                    console.log('An error occurred: ' + err.message);
                })
                .on('end', function () {
                    console.log('Processing finished !');
                    cb(converted);
                });
        });
    }
    else {
        headers['Content-Type'] = attachment.contentType;
        cb(needle.get(attachment.contentUrl, { headers: headers }));
    }
}

function checkRequiresToken(message) {
    return message.source === 'skype' || message.source === 'msteams';
}