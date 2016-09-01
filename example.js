/**
 * Usage to add items: $ node example.js {id}
 * Usage for workers: $ node example.js
 *
 * Spawn as many workers as you like, and add as many items as you please
 */
var async = require('async');
var ms = require('ms');

// var admiral = require('admiral');
var admiral = require('./lib/admiral');

var queue = admiral.createQueue({
  default_wait: '30s',
  prefix: 'hardly-working'
});

if (process.argv.slice(2).length) {
  async.eachSeries(process.argv.slice(2), function (item, nextItem) {
    queue.create('task', item, nextItem);
  }, function (err) {
    if (err) throw err;
    process.exit(0);
  });
}
else {
  var count = 1;

  queue.on('error', function (err) {
    console.error('ERR:', err);
  });

  queue.process('task', function (job, callback) {
    console.log('Processing %s that was queued at %s', job.id, job.timestamp);
    setTimeout(function () {
      console.log('Finished #%d %s', count++, job.id);
      callback();
    }, ms('25s'));
  });

  console.log('Waiting for work..');
}
