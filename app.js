"use strict";
exports.__esModule = true;
var express = require("express");
var builder = require("botbuilder");
var handoff = require("botbuilder-handoff");
//=========================================================
// Normal Bot Setup
//=========================================================
var app = express();
// Setup Express Server
app.listen(process.env.port || process.env.PORT || 3978, '::', function () {
    console.log('Server Up');
});
// Create chat bot
var connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});
app.post('/api/messages', connector.listen());
var bot = new builder.UniversalBot(connector, [
    function (session, args, next) {
        session.endConversation('Echo ' + session.message.text);
    }
]);
//=========================================================
// Hand Off Setup
//=========================================================
// Replace this function with custom login/verification for agents
var isAgent = function (session) { return session.message.user.name.startsWith("Agent"); };
/**
    bot: builder.UniversalBot
    app: express ( e.g. const app = express(); )
    isAgent: function to determine when agent is talking to the bot
    options: { }
**/
handoff.setup(bot, app, isAgent, {
    mongodbProvider: 'mongodb://mshkstorechatbothumanhandoff:v9ZKa4MZHQxl43i2FbiwLu4rSa09y2BOFBK4QHRAJNAILntFQa0HwsoKZ5zdOl2NP7FcEQHpVyDcBXZiBRMrVw==@mshkstorechatbothumanhandoff.documents.azure.com:10255/?ssl=true&replicaSet=globaldb',
    directlineSecret: '0hxweWjk0Fo.cwA.NNI.dcZFbuBvlbFE6ScHspCBjpbymXnvCLF4igN1dXnIC7g',
    textAnalyticsKey: process.env.CG_SENTIMENT_KEY,
    appInsightsInstrumentationKey: process.env.APPINSIGHTS_INSTRUMENTATIONKEY,
    retainData: 'false',
    customerStartHandoffCommand: process.env.CUSTOMER_START_HANDOFF_COMMAND
});
