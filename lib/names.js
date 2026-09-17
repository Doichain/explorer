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
function lookup(name, cb) {
  if (!settings.electrumx || settings.electrumx.enabled === false) return cb(null, null);
  if (typeof name !== 'string' || name.length === 0) return cb(null, null);

  function answer(tried, history) {
    if (!history || history.length === 0) return null;
    var newest = history[history.length - 1];
    return { txid: newest.tx_hash, height: newest.height, name: tried };
  }

  history_of(name, function(err, history) {
    if (err) return cb(err);
    var hit = answer(name, history);
    if (hit) return cb(null, hit);

    var normalised = name.normalize ? name.normalize('NFC') : name;
    if (normalised === name) return cb(null, null);

    history_of(normalised, function(err2, history2) {
      if (err2) return cb(err2);
      cb(null, answer(normalised, history2));
    });
  });
}

module.exports = { lookup: lookup };
