const Fs = require("fs");
const Iota = require("iota.lib.js");
const CryptoJS = require("crypto-js");


class Tanglestash {
    /**
     * TANGLESTASH
     * **/

    constructor() {

    }

    persistToTangle(data, datatype) {

    }

    static encrypt(plaintext, secret) {
        let ciphertext = CryptoJS.AES.encrypt(plaintext, secret);
        return ciphertext.toString();
    }

    static decrypt(ciphertext, secret) {
        let bytes  = CryptoJS.AES.decrypt(ciphertext, secret);
        return bytes.toString(CryptoJS.enc.Utf8);
    }
}

module.exports = { Tanglestash };
