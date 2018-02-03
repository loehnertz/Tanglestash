const Fs = require("fs");
const Path = require("path");

const CryptoJS = require("crypto-js");


/**
 * Helper methods for the main class
 */
class TanglestashHelpers {
    static parseFileIntoBase64(path) {
        let buffer = new Buffer(Fs.readFileSync(Path.resolve(path)));
        return buffer.toString('base64');
    }

    static parseStringIntoBase64(string) {
        return new Buffer(string).toString('base64');
    }

    static parseFileFromBase64(base64) {
        return new Buffer(base64, 'base64');
    }

    static parseStringFromBase64(base64) {
        return new Buffer(base64, 'base64').toString('utf-8');
    }

    static encrypt(plaintext, secret) {
        let ciphertext = CryptoJS.AES.encrypt(plaintext, secret);
        return ciphertext.toString();
    }

    static decrypt(ciphertext, secret) {
        let bytes = CryptoJS.AES.decrypt(ciphertext, secret);
        try {
            return bytes.toString(CryptoJS.enc.Utf8);
        } catch (err) {
            return false;
        }
    }
}


module.exports = TanglestashHelpers;
