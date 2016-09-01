var assert = require('assert');
var lib = module.exports = {};
var redis = require('redis').createClient();

lib.redis = redis;

lib.assertEqualSMEMBERS = function (key, expected, message) {
  return function (callback) {
    redis.SMEMBERS(key, function (err, types) {
      if (!err) assert.deepEqual(types, expected, message);
      callback(err);
    });
  };
};

lib.assertEqualZCARD = function (key, expected, message) {
  return function (callback) {
    redis.ZCARD(key, function (err, count) {
      if (!err) assert.equal(count, expected, message);
      callback(err);
    });
  };
};

lib.assertEqualZSCORE = function (key, id, expected, message) {
  return function (callback) {
    redis.ZSCORE(key, id, function (err, score) {
      if (!err) assert.equal(score, expected, message);
      callback(err);
    });
  };
};

// ZMEMBERS is SMEMBERS for a sorted-set
lib.assertEqualZMEMBERS = function (key, expected, message) {
  return function (callback) {
    redis.ZRANGE(key, 0, -1, function (err, members) {
      if (!err) assert.deepEqual(members.sort(), expected.sort(), message);
      callback(err);
    });
  };
};
