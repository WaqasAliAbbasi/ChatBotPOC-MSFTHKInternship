var express = require('express'),
    builder = require('botbuilder'),
    needle = require('needle'),
    ffmpeg = require('fluent-ffmpeg'),
    speechService = require('./speech-service.js'),
    cognitiveservices = require('botbuilder-cognitiveservices');

var EventHubClient = require('azure-event-hubs').Client;
var Promise = require('bluebird');

Object.defineProperty(exports, "__esModule", { value: true });
const handoff_1 = require("./handoff");
const commands_1 = require("./commands");

// Setup Express Server (N.B: If you are already using restify for your bot, you will need replace it with an express server)
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
var luisrecognizer = new builder.LuisRecognizer("https://westus.api.cognitive.microsoft.com/luis/v2.0/apps/c5c8f1ac-46b4-46ce-8429-6ef105f6034d?subscription-key=2c282b6ca94042ac891d9b66315517c3&staging=true&verbose=true&timezoneOffset=0&q=");
bot.recognizer(luisrecognizer);

// QnA API
var qnarecognizer = new cognitiveservices.QnAMakerRecognizer({
    knowledgeBaseId: 'ddf84096-4497-490b-806e-4933de04956c',
    subscriptionKey: '93f6d1046640412f853ff47f36a15c46'
});
bot.recognizer(qnarecognizer);

// replace this function with custom login/verification for agents
const isAgent = (session) => session.message.user.name.startsWith("Agent");
const handoff = new handoff_1.Handoff(bot, isAgent);

//=========================================================
// Bots Global Actions
//=========================================================

bot.endConversationAction('goodbye', 'Goodbye :)', { matches: /^goodbye/i });
bot.beginDialogAction('reset', '/reset', { matches: /^reset/i });

////=========================================================
//// Bot Human Handoff
////=========================================================

//// Replace this functions with custom login/verification for agents
//const isAgent = (session) => session.message.user.name.startsWith("Agent");

///**
//    bot: builder.UniversalBot
//    app: express ( e.g. const app = express(); )
//    isAgent: function to determine when agent is talking to the bot
//    options: { }     
//**/
//handoff.setup(bot, server, isAgent, {
//    mongodbProvider: 'mongodb://mshkstorechatbothumanhandoff:v9ZKa4MZHQxl43i2FbiwLu4rSa09y2BOFBK4QHRAJNAILntFQa0HwsoKZ5zdOl2NP7FcEQHpVyDcBXZiBRMrVw==@mshkstorechatbothumanhandoff.documents.azure.com:10255/?ssl=true&replicaSet=globaldb',
//    directlineSecret: '0hxweWjk0Fo.cwA.NNI.dcZFbuBvlbFE6ScHspCBjpbymXnvCLF4igN1dXnIC7g',
//    textAnalyticsKey: process.env.CG_SENTIMENT_KEY,
//    appInsightsInstrumentationKey: process.env.APPINSIGHTS_INSTRUMENTATIONKEY,
//    retainData: process.env.RETAIN_DATA,
//    customerStartHandoffCommand: process.env.CUSTOMER_START_HANDOFF_COMMAND
//});

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
    session.endDialog("Hi %s, How can I help you?",session.message.user.name);
});

//=========================================================
// Bots Middleware
//=========================================================

var client = EventHubClient.fromConnectionString('Endpoint=sb://mshkstorechatbot.servicebus.windows.net/;SharedAccessKeyName=messenger;SharedAccessKey=2uCArt10J6FUENAfR83+fFyPzdgs4o5WfgKTrzkBFy4=;EntityPath=mshkchatbot', 'mshkchatbot');

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
            client.open()
                .then(function () {
                    return client.createSender();
                })
                .then(function (tx) {
                    tx.on('errorReceived', function (err) { console.log(err); });
                    tx.send({    
                        contents: session.message.text, time: new Date().toISOString() }, 'my-pk');
                });
            next();
        },
		commands_1.commandsMiddleware(handoff), handoff.routingMiddleware()
    ]
});

//=========================================================
// Bots Dialogs
//=========================================================

bot.dialog('/', function (session) {
    session.endDialog("Sorry, I can't help you with that. Please contact our customer support representative at https://www.microsoftstore.com.hk/faq/contact_us");
});

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

bot.dialog('/qna', function (session, args) {
    var answerEntity = builder.EntityRecognizer.findEntity(args.intent.entities, 'answer');
    session.endDialog(answerEntity.entity);
}).triggerAction({
    matches: 'qna',
    intentThreshold: 0.50
    });

bot.dialog('/None', function (session) {
    session.endDialog("Sorry, I can't help you with that. Please contact our customer support representative at https://www.microsoftstore.com.hk/faq/contact_us");
}).triggerAction({
    matches: 'None'
});

//=========================================================
// Utilities
//=========================================================

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