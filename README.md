# Tanglestash
[![license](https://img.shields.io/npm/l/tanglestash.svg)](https://www.npmjs.com/package/tanglestash)
[![npm](https://img.shields.io/npm/v/tanglestash.svg)](https://www.npmjs.com/package/tanglestash)
[![npm](https://img.shields.io/npm/dt/tanglestash.svg)](https://www.npmjs.com/package/tanglestash)
[![daviddm](https://david-dm.org/loehnertz/Tanglestash.svg)](https://david-dm.org/loehnertz/Tanglestash)
\
IOTA meets BitTorrent: An algorithm to persist any file onto the tangle of IOTA


## Features

- Persist any data onto the tangle of IOTA
- Retrieve data that was persisted with this module beforehand
- Optionally encrypt your data with a password (via AES)
- Store a string or even a whole file without any prior conversion


## GUI

**Check out my other project [tanglesta.sh](http://tanglesta.sh/) here on GitHub
which implements this module into a full-blown desktop app available for Windows, macOS and Linux.**


## Idea

I really like the idea of the tangle of IOTA and I think that this cryptocurrency
has a bright future. I run a full node myself and want the idea to succeed.
The more I messed with IOTA, the further this idea formed in my mind to use
the 2187 trytes of each transactions signature to store any data on the
decentralised tangle.

This module can persist any string or even files directly onto the tangle
via creating a torrent-esque chain of transactions that reference other transactions
holding the data while also referencing their direct predecessor in the chain.
That way, this module can also retrieve any data that was persisted beforehand by
just passing the 'entry-hash' into it, which is the first transaction hash of the created chain.
The data can be optionally encrypted with a secret via AES so that even if someone
gets hold of an 'entry-hash', the data will still be illegible.
Data is stored as a Base64 string and files will be automatically encoded if passed
into the algorithm as well as decoded if retrieved – no prior conversion of the file needed.


## Disclaimer

I know that primarily the persisting to the tangle is painfully slow compared to a traditional HTTP upload.\
Keep in mind though that this project is more of a proof-of-concept rather than a finished product.\
The reason that it takes so long is mainly the current speed of the PoW, which might get faster in the future with new techniques.


## Installation

NPM
```
npm install --save tanglestash
```

Yarn
```
yarn add tanglestash
```

Additionally, one needs [IRI](https://github.com/iotaledger/iri) (the node software) to do the Proof-of-Work for each transaction.\
One could use a local instance of it or a remote public node that supports PoW e.g. from this list: https://iota.dance/nodes \
Alternatively, one could utilize the great `iotaproxy` project by [TimSamshuijzen](https://github.com/TimSamshuijzen).\
Read more about it here: https://github.com/TimSamshuijzen/iotaproxy/blob/master/README.md


## Usage

First off, create a new instance of the modules class
```js
let tanglestash = new Tanglestash(provider, datatype, seed);
```
with the following arguments:
1. **`provider`**: `String` A URI of an IOTA full node
2. **`datatype`**: `String` Either 'file' or 'string' based on the data that will later be used
3. **`seed`**: `String` `[Optional]` An IOTA wallet seed; will be automatically generated if not passed here


---

### `readFromTangle`

Retrieves data that was persisted onto the tangle in the past.

#### Input
```js
tanglestash.readFromTangle(entryHash, secret)
```

1. **`entryHash`**: `String` Any transaction hash that was output after successfully persisting data beforehand; called 'entry-hash'
2. **`secret`**: `String` `[Optional]` The password the data was encrypted with; if any

#### Return Value

1. **`Promise.<*>`** - A file buffer of the retrieved data or a string based on `this.datatype`

---

### `saveToTangle`

Persists data onto the tangle.

#### Input
```js
tanglestash.saveToTangle(data, secret)
```

1. **`data`**: `String` The data as a string or file path based on `this.datatype`
2. **`secret`**: `String` `[Optional]` The password the data should be encrypted with; if any

#### Return Value

1. **`Promise.<string>`** - The last transaction hash of the created chain; called 'entry-hash'

---

### `generateRandomIotaSeed`

Generates a random valid IOTA wallet seed.

#### Input
```js
tanglestash.generateRandomIotaSeed()
```

#### Return Value

1. **`String`** - The generated seed

---

### `getNewIotaAddress`

Retrieves a new valid IOTA wallet address based on `this.seed`.

#### Input
```js
tanglestash.getNewIotaAddress()
```

#### Return Value

1. **`Promise.<string>`** - The retrieved wallet address

---

### `getAllMarkyEntries`

Returns all the `marky` entries used to time the main processes.
If you've never used `marky` before, learn more about it [here](https://www.npmjs.com/package/marky).

#### Input
```js
tanglestash.getAllMarkyEntries()
```

#### Return Value

1. **`Array.<object>`** - All the timing entries created by `marky`


## Donations

If you like this module and want to support it, you can of course donate some IOTA 😊 \
`QIFKUOEQBCEV9NKFWDBTQYBHLFFORLVKDQSYDSZQQMKTCBLBFDQMJWIOUDH9DLZXVKGNQGKLSAJCQQMEDESLCTHGZD`


## License

[MIT](LICENSE)
