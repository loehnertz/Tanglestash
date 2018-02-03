/**
 * Custom Errors
 * **/

class IncorrectPasswordError extends Error {
    constructor(...args) {
        super(...args);
        this.name = IncorrectPasswordError.name;
    }
}

class IncorrentDatatypeError extends Error {
    constructor(...args) {
        super(...args);
        this.name = IncorrentDatatypeError.name;
    }
}

class IncorrectTransactionHashError extends Error {
    constructor(...args) {
        super(...args);
        this.name = IncorrectTransactionHashError.name;
    }
}

class NodeOutdatedError extends Error {
    constructor(...args) {
        super(...args);
        this.name = NodeOutdatedError.name;
    }
}


module.exports = {
    IncorrectPasswordError,
    IncorrentDatatypeError,
    IncorrectTransactionHashError,
    NodeOutdatedError,
};
