/**
* Name lookup for the search box.
*
* A name is not in the explorer's own database -- that indexes addresses and
* transactions, not names. ElectrumX does index them: every operation on a name
* is stored under one script hash, which @doichain/doichainjs-lib derives from
* the name itself. `blockchain.scripthash.get_history` on that hash lists every
* operation on the name, oldest first, so the last entry is the one that holds
* it today.
*/

var net = require('net');
var nameops = require('@doichain/doichainjs-lib').nameops;
var settings = require('./settings');

/**
* One request against ElectrumX, on its own connection.
*
* The server pushes notifications of its own, so a plain "read the next line"
* can pick up something that is not the answer. Every response is matched
* against the id that was sent.
*/
function call(method, params, cb) {
  var cfg = settings.electrumx;
  var done = false;
  var buf = '';
  var id = 1;

  function finish(err, result) {
    if (done) return;
    done = true;
    try { socket.destroy(); } catch (e) { /* schon zu */ }
    cb(err, result);
  }

  var socket = net.createConnection({ host: cfg.host, port: cfg.port });
  socket.setEncoding('utf8');
  socket.setTimeout(cfg.timeout);

  socket.on('connect', function() {
    socket.write(JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params }) + '\n');
  });

  socket.on('data', function(chunk) {
    buf += chunk;
    var i;
    while ((i = buf.indexOf('\n')) >= 0) {
      var line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      var msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      if (msg.id !== id) continue;
      if (msg.error) return finish(new Error(JSON.stringify(msg.error)));
      return finish(null, msg.result);
    }
  });

  socket.on('timeout', function() { finish(new Error('electrumx timeout')); });
  socket.on('error', function(e) { finish(e); });
  socket.on('close', function() { finish(new Error('electrumx closed the connection')); });
}

function history_of(name, cb) {
  var hash;
  try {
    hash = nameops.nameIndexScriptHash(name);
  } catch (e) {
    return cb(e);
  }
  call('blockchain.scripthash.get_history', [hash], cb);
}

/**
* Looks a name up and calls back with the transaction that last operated on it.
*
*   cb(null, null)                     -- no operation on this name, ever
*   cb(null, {txid, height, name})     -- found
*   cb(err)                            -- ElectrumX unreachable or failed
*
* The name is tried exactly as typed first. Only if that finds nothing is the
* Unicode-normalised form tried, because a name is bytes: the registered name
* may well be the unnormalised one, and guessing first would find the wrong
* entry. Plain ASCII names normalise to themselves, so this costs one call.
*/
function resolve(name, cb) {
  if (!settings.electrumx || settings.electrumx.enabled === false) return cb(null, null);
  if (typeof name !== 'string' || name.length === 0) return cb(null, null);

  history_of(name, function(err, history) {
    if (err) return cb(err);
    if (history && history.length) return cb(null, { name: name, history: history });

    var normalised = name.normalize ? name.normalize('NFC') : name;
    if (normalised === name) return cb(null, null);

    history_of(normalised, function(err2, history2) {
      if (err2) return cb(err2);
      if (history2 && history2.length) return cb(null, { name: normalised, history: history2 });
      cb(null, null);
    });
  });
}

/**
* Looks a name up and calls back with the transaction that last operated on it.
*
*   cb(null, null)                     -- no operation on this name, ever
*   cb(null, {txid, height, name})     -- found
*   cb(err)                            -- ElectrumX unreachable or failed
*/
function lookup(name, cb) {
  resolve(name, function(err, found) {
    if (err) return cb(err);
    if (!found) return cb(null, null);
    var newest = found.history[found.history.length - 1];
    cb(null, { txid: newest.tx_hash, height: newest.height, name: found.name });
  });
}

/**
* Everything the name page needs: the whole history newest first, each entry
* with the operation it carried, plus whether the name has expired.
*
* Expiry follows the consensus rule in names/main.cpp: an operation at height h
* is expired once the chain reaches h + NameExpirationDepth, which is 36000 on
* mainnet. Note the "<=" there -- the name is expired AT that height, not after
* it. Only the newest operation counts; every operation renews the name.
*
* Details are fetched per transaction, so a name with a very long history is
* capped (electrumx.history_limit); the remaining entries are still listed, just
* without their operation.
*/
function page(name, cb) {
  resolve(name, function(err, found) {
    if (err) return cb(err);
    if (!found) return cb(null, null);

    var limit = (settings.electrumx && settings.electrumx.history_limit) || 25;
    var newestFirst = found.history.slice().reverse();
    var entries = newestFirst.map(function(h) {
      return { txid: h.tx_hash, height: h.height, op: null, value: null, time: null };
    });
    var todo = Math.min(entries.length, limit);
    var pending = todo;
    if (todo === 0) return cb(null, build(found.name, entries, newestFirst.length));

    entries.slice(0, todo).forEach(function(entry) {
      call('blockchain.transaction.get', [entry.txid, true], function(e, tx) {
        if (!e && tx) {
          entry.time = tx.blocktime || tx.time || null;
          entry.blockhash = tx.blockhash || null;
          (tx.vout || []).forEach(function(o) {
            var n = o.scriptPubKey && o.scriptPubKey.nameOp;
            if (n && !entry.op) {
              entry.op = n.op || null;
              entry.value = (n.value !== undefined ? n.value : n.value_error) || null;
              entry.address = (o.scriptPubKey.address) || null;
            }
          });
        }
        if (--pending === 0) cb(null, build(found.name, entries, newestFirst.length));
      });
    });
  });
}

function build(name, entries, total) {
  var newest = entries[0];
  var depth = (settings.electrumx && settings.electrumx.name_expiration) || 36000;
  return {
    name: name,
    entries: entries,
    total: total,
    newest: newest,
    // 0 and -1 mean "in the mempool": no height yet, so nothing can expire.
    pending: !newest || newest.height <= 0,
    expires_at: (newest && newest.height > 0) ? newest.height + depth : null,
    expiration_depth: depth
  };
}

module.exports = { lookup: lookup, page: page };
