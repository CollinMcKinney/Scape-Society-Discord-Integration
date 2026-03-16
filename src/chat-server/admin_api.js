const auth = require("./auth");
const authenticate = auth.authenticate;
const verifySession = auth.verifySession;

const datastore = require("./datastore");
const saveState = datastore.saveState;
const loadState = datastore.loadState;

const messages = require("./messages");
const addMessage = messages.addMessage;
const getMessages = messages.getMessages;
const deleteMessage = messages.deleteMessage;
const editMessage = messages.editMessage;

const notifications = require("./notification");
const addNotification = notifications.addNotification;
const getNotifications = notifications.getNotifications;
const deleteNotification = notifications.deleteNotification;
const editNotification = notifications.editNotification;

const users = require("./users");
const createUser = users.createUser;
const listUsers = users.listUsers;
const getUser = users.getUser;
const setRole = users.setRole;

// const test_module = require("./test_module");
// const add = test_module.add;
// const greet = test_module.greet;


module.exports = {
    authenticate,
    verifySession,
    saveState,
    loadState,
    addMessage,
    getMessages,
    deleteMessage,
    editMessage,
    addNotification,
    getNotifications,
    deleteNotification,
    editNotification,
    createUser,
    listUsers,
    getUser,
    setRole,
    
    // add,
    // greet
};