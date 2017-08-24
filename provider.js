"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const handoff_1 = require("./handoff");
exports.init = () => {
    exports.conversations = [];
};
// Update
const addToTranscript = (by, text) => {
    const conversation = getConversation(by);
    if (!conversation)
        return false;
    conversation.transcript.push({
        timestamp: Date.now(),
        from: by.agentConversationId ? 'agent' : 'customer',
        text
    });
    return true;
};
const connectCustomerToAgent = (by, stateUpdate, agentAddress) => {
    const conversation = getConversation(by);
    if (conversation) {
        conversation.state = stateUpdate;
        conversation.agent = agentAddress;
    }
    return conversation;
};
const queueCustomerForAgent = (by) => {
    const conversation = getConversation(by);
    if (!conversation)
        return false;
    conversation.state = handoff_1.ConversationState.Waiting;
    if (conversation.agent)
        delete conversation.agent;
    return true;
};
const connectCustomerToBot = (by) => {
    const conversation = getConversation(by);
    if (!conversation)
        return false;
    conversation.state = handoff_1.ConversationState.Bot;
    if (conversation.agent)
        delete conversation.agent;
    return true;
};
// Get
const getConversation = (by, customerAddress // if looking up by customerConversationId, create new conversation if one doesn't already exist
) => {
    // local function to create a conversation if customer does not already have one
    const createConversation = (customerAddress) => {
        const conversation = {
            customer: customerAddress,
            state: handoff_1.ConversationState.Bot,
            transcript: []
        };
        exports.conversations.push(conversation);
        return conversation;
    };
    if (by.bestChoice) {
        const waitingLongest = exports.conversations
            .filter(conversation => conversation.state === handoff_1.ConversationState.Waiting)
            .sort((x, y) => y.transcript[y.transcript.length - 1].timestamp - x.transcript[x.transcript.length - 1].timestamp);
        return waitingLongest.length > 0 && waitingLongest[0];
    }
    if (by.customerName) {
        return exports.conversations.find(conversation => conversation.customer.user.name == by.customerName);
    }
    else if (by.agentConversationId) {
        return exports.conversations.find(conversation => conversation.agent && conversation.agent.conversation.id === by.agentConversationId);
    }
    else if (by.customerConversationId) {
        let conversation = exports.conversations.find(conversation => conversation.customer.conversation.id === by.customerConversationId);
        if (!conversation && customerAddress) {
            conversation = createConversation(customerAddress);
        }
        return conversation;
    }
    return null;
};
const currentConversations = () => exports.conversations;
exports.defaultProvider = {
    init: exports.init,
    // Update
    addToTranscript,
    connectCustomerToAgent,
    connectCustomerToBot,
    queueCustomerForAgent,
    // Get
    getConversation,
    currentConversations
};
