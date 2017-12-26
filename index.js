const Fs = require("fs");
const Iota = require("iota.lib.js");
const CryptoJS = require("crypto-js");


class Tanglestash {
    /**
     * TANGLESTASH
     * **/

    constructor(datatype, secret) {
        this.datatype = datatype || 'file';  // Set file as the default 'datatype' in case none was passed
        this.secret = secret || null;  // Set the secret to 'null' if the user does not want to use encryption
    }

    persistToTangle(data) {

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

module.exports = Tanglestash;
