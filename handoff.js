"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const builder = require("botbuilder");
const provider_1 = require("./provider");
// Options for state of a conversation
// Customer talking to bot, waiting for next available agent or talking to an agent
var ConversationState;
(function (ConversationState) {
    ConversationState[ConversationState["Bot"] = 0] = "Bot";
    ConversationState[ConversationState["Waiting"] = 1] = "Waiting";
    ConversationState[ConversationState["Agent"] = 2] = "Agent";
    ConversationState[ConversationState["Watch"] = 3] = "Watch";
})(ConversationState = exports.ConversationState || (exports.ConversationState = {}));
;
class Handoff {
    // if customizing, pass in your own check for isAgent and your own versions of methods in defaultProvider
    constructor(bot, isAgent, provider = provider_1.defaultProvider) {
        this.bot = bot;
        this.isAgent = isAgent;
        this.provider = provider;
        this.connectCustomerToAgent = (by, nextState, agentAddress) => this.provider.connectCustomerToAgent(by, nextState, agentAddress);
        this.connectCustomerToBot = (by) => this.provider.connectCustomerToBot(by);
        this.queueCustomerForAgent = (by) => this.provider.queueCustomerForAgent(by);
        this.addToTranscript = (by, text) => this.provider.addToTranscript(by, text);
        this.getConversation = (by, customerAddress) => this.provider.getConversation(by, customerAddress);
        this.currentConversations = () => this.provider.currentConversations();
        this.provider.init();
    }
    routingMiddleware() {
        return {
            botbuilder: (session, next) => {
                // Pass incoming messages to routing method
                if (session.message.type === 'message') {
                    this.routeMessage(session, next);
                }
            },
            send: (event, next) => {
                // Messages sent from the bot do not need to be routed
                const message = event;
                const customerConversation = this.getConversation({ customerConversationId: event.address.conversation.id });
                // send message to agent observing conversation
                if (customerConversation.state === ConversationState.Watch) {
                    this.bot.send(new builder.Message().address(customerConversation.agent).text(message.text));
                }
                this.trancribeMessageFromBot(message, next);
            }
        };
    }
    routeMessage(session, next) {
        if (this.isAgent(session)) {
            this.routeAgentMessage(session);
        }
        else {
            this.routeCustomerMessage(session, next);
        }
    }
    routeAgentMessage(session) {
        const message = session.message;
        const conversation = this.getConversation({ agentConversationId: message.address.conversation.id });
        // if the agent is not in conversation, no further routing is necessary
        if (!conversation)
            return;
        // if the agent is observing a customer, no need to route message
        if (conversation.state !== ConversationState.Agent)
            return;
        // send text that agent typed to the customer they are in conversation with
        this.bot.send(new builder.Message().address(conversation.customer).text(message.text));
    }
    routeCustomerMessage(session, next) {
        const message = session.message;
        // method will either return existing conversation or a newly created conversation if this is first time we've heard from customer
        const conversation = this.getConversation({ customerConversationId: message.address.conversation.id }, message.address);
        this.addToTranscript({ customerConversationId: conversation.customer.conversation.id }, message.text);
        switch (conversation.state) {
            case ConversationState.Bot:
                return next();
            case ConversationState.Waiting:
                session.send("Connecting you to the next available agent.");
                return;
            case ConversationState.Watch:
                this.bot.send(new builder.Message().address(conversation.agent).text(message.text));
                return next();
            case ConversationState.Agent:
                if (!conversation.agent) {
                    session.send("No agent address present while customer in state Agent");
                    console.log("No agent address present while customer in state Agent");
                    return;
                }
                this.bot.send(new builder.Message().address(conversation.agent).text(message.text));
                return;
        }
    }
    // These methods are wrappers around provider which handles data
    trancribeMessageFromBot(message, next) {
        this.provider.addToTranscript({ customerConversationId: message.address.conversation.id }, message.text);
        next();
    }
    getCustomerTranscript(by, session) {
        const customerConversation = this.getConversation(by);
        if (customerConversation) {
            customerConversation.transcript.forEach(transcriptLine => session.send(transcriptLine.text));
        }
        else {
            session.send('No Transcript to show. Try entering a username or try again when connected to a customer');
        }
    }
}
exports.Handoff = Handoff;
;
