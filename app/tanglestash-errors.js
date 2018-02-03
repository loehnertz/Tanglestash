/**
 * Custom Errors
 */

class IncorrectPasswordError extends Error {
    constructor(...args) {
        super(...args);
        this.name = IncorrectPasswordError.name;
    }
}

class IncorrectDatatypeError extends Error {
    constructor(...args) {
        super(...args);
        this.name = IncorrectDatatypeError.name;
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

class NodeCouldNotProvideTransactionsToApproveError extends Error {
    constructor(...args) {
        super(...args);
        this.name = NodeCouldNotProvideTransactionsToApproveError.name;
    }
}

class LibccurlCreationError extends Error {
    constructor(...args) {
        super(...args);
        this.name = LibccurlCreationError.name;
    }
}

class TryteLoopingError extends Error {
    constructor(...args) {
        super(...args);
        this.name = TryteLoopingError.name;
    }
}

class LibccurlInterruptionError extends Error {
    constructor(...args) {
        super(...args);
        this.name = LibccurlInterruptionError.name;
    }
}


module.exports = {
    IncorrectPasswordError,
    IncorrectDatatypeError,
    IncorrectTransactionHashError,
    NodeOutdatedError,
    NodeCouldNotProvideTransactionsToApproveError,
    LibccurlCreationError,
    TryteLoopingError,
    LibccurlInterruptionError,
};
