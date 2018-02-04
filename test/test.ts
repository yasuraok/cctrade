import {Link, Average} from "../avg";
import {PriceDB}       from "../price";
import {Util}          from "../util";
import {Agent}         from "../agent";

var assert = require('assert');
var fs     = require('fs');
import * as mocha from "mocha";

////////////////////////////////////////////////////////////////////////////////

let config   = JSON.parse(fs.readFileSync('./config.json'));
let mongoUrl = `mongodb://${config.mongo_url}:${config.mongo_port}/`;

describe('util', function () {
    it('test for fixupFloat', function(){
      let d1 = Util.fixupFloat(20.42 - 10.1, 0.01);
      assert.equal(d1, 10.32);

      let d2 = Util.fixupFloat(0 - 0.0739, 0.0001);
      assert.equal(d2, -0.0739);
    });
});

describe('avg', function () {
    it('test for Link class', function(){
      var l = new Link({"hoge": 1, "foo": 2})
      var end = l.connect(new Link({"hoge": 3, "foo": 4})).connect(new Link({"hoge": 5, "foo": 6}))

      for(var x = l; x != null; x = x.next){
        // console.log(x.item);
      }

      end = end.disconnect();
      assert.equal(3, end.item.hoge); assert.equal(4, end.item.foo);

      end = end.disconnect();
      assert.equal(1, end.item.hoge); assert.equal(2, end.item.foo);

      end = end.disconnect();
      assert.equal(null, end);
    });

    it('test for Link::fromArray', function(){
      let l = Link.fromArray([1,2,3,4,5]);
      assert.equal(2, l.next.next.prev.item);
    })

    it('test for Link::concat', function(){
      let l1 = Link.fromArray([1,2]);
      let l2 = Link.fromArray([3,4,5]);
      let l  = Link.concat(l1, l2);
      assert.equal(3, l.next.next.item);
      assert.equal(4, l.next.next.next.item);
    })

    it('test for Link::map', function(){
      let l = Link.fromArray([1,2,3,4,5]);
      let a = l.map((node) => node.item**2);
      assert.equal(4,  a[1]);
      assert.equal(16, a[3]);
    })

    it('test for Link::slice', function(){
      let l  = Link.fromArray([1,2,3,4,5]);
      let s1 = l.slice(2,4);
      let s2 = l.slice(0,4);
      assert.equal(s1.length, 2);
      assert.equal(s1.next.item, 4);
      assert.equal(s2.length, 4)
      assert.equal(s2.end().item, 4);
    })

    it('test for Average class', function(){
      var prices = Link.fromArray([
        {"ask":200, "bid":100},
        {"ask":210, "bid":140},
        {"ask":205, "bid":130},
        {"ask":225, "bid":160},
        {"ask":235, "bid":130},
        {"ask":205, "bid":140}
      ]);
      var avg = new Average(prices);
      assert.equal(200, avg.getAskAvg(1));
      assert.equal((200 + 210 + 205 + 225) / 4, avg.getAskAvg(4));

      assert.equal((100 + 140) / 2, avg.getBidAvg(2));
      assert.equal((100 + 140 + 130 + 160 + 130 + 140) / 6, avg.getBidAvg(6));
      assert.equal(avg.getBidAvg(6), avg.getBidAvg(7));

      var avg2 = new Average(prices.next);
      assert.equal(210, avg2.getAskAvg(1));
      assert.equal((210 + 205) / 2, avg2.getAskAvg(2));
    });
});

////////////////////////////////////////////////////////////////////////////////

describe('price', function () {
    it('test for price insert/delete', function(){
      let testPair:string = "test1";
      let priceDB = new PriceDB(mongoUrl, config.mongo_dbname, testPair);

      const ask1:number = 400;
      const ask2:number = 420;
      const ask3:number = 450;
      const bid1:number = 350;
      const bid2:number = 370;
      const bid3:number = 320;

      return priceDB.clear()
        .then(() => {
        return priceDB.insert(testPair, ask1, bid1);
      }).then((result) => {
        return new Promise(r => setTimeout(r, 200)); // 待つ
      }).then(() => {
        return priceDB.insert(testPair, ask2, bid2);
      }).then((result) => {
        return priceDB.fetch(testPair, 1000);
      }).then(() => {
        // console.log(`priceDB.avgs=${priceDB.avgs}, length=${priceDB.avgs.length}`)
        assert.equal(2, priceDB.prices.length);
        assert.equal(2, priceDB.avgs.length);
        assert.equal(ask2, priceDB.avgs[0].getAskAvg(1)); // この時点での最新はask2
        assert.equal((bid2 + bid1) / 2, priceDB.avgs[0].getBidAvg(2));
        return;
      }).then(() => {
        return new Promise(r => setTimeout(r, 200)); // 待つ
      }).then(() => {
        return priceDB.insert(testPair, ask3, bid3);
      }).then((result) => {
        return priceDB.fetch(testPair, 1000);
      }).then(() => {
        assert.equal(3, priceDB.prices.length);
        assert.equal(3, priceDB.avgs.length);
        assert.equal(ask3, priceDB.avgs[0].getAskAvg(1)); // この時点での最新はask3
        assert.equal((bid2 + bid1) / 2, priceDB.avgs[1].getBidAvg(2)); // 最新から1時刻過去データから2時刻分の移動平均
        return;
      });
    });

    it('test for price truncate', function(){
      let testPair:string = "test2";
      var priceDB = new PriceDB(mongoUrl, config.mongo_dbname, testPair);

      return priceDB.clear()
        .then(() => {
        return priceDB.insert(testPair, 1, 1);
      }).then((result) => {
        return priceDB.insert(testPair, 2, 2);
      }).then((result) => {
        return priceDB.fetch(testPair, 1000);
      }).then(() => {
        assert.equal(2, priceDB.prices.length);
        assert.equal(2, priceDB.avgs.length);
        return;
      }).then(() => {
        return priceDB.insert(testPair, 3, 3);
      }).then((result) => {
        return priceDB.fetch(testPair, 2);
      }).then(() => {
        assert.equal(2, priceDB.prices.length);
        assert.equal(2, priceDB.avgs.length);
        return;
      }).then(() => {
        return priceDB.insert(testPair, 4, 4);
      }).then((result) => {
        return priceDB.insert(testPair, 5, 5);
      }).then((result) => {
        return priceDB.insert(testPair, 6, 6);
      }).then((result) => {
        return priceDB.fetch(testPair, 3);
      }).then(() => {
        assert.equal(3, priceDB.prices.length);
        assert.equal(3, priceDB.avgs.length);

        assert.equal(6, priceDB.prices.item.ask);
        assert.equal(6, priceDB.avgs[0].getAskAvg(1));
        return;
      });
    });
});

////////////////////////////////////////////////////////////////////////////////
describe('agent', function () {
    it('test for agent ParamDB', function(){
      let paramDB = new Agent.ParamDB(mongoUrl, config.mongo_dbname, "test_jpy");

      let records = [{profit: 100}, {profit: 50}, {profit: 200}];
      paramDB.replace(records)
        .then(() => {
          return paramDB.find();
        })
        .then((results) => {
          assert.equal(records.length, results.length);
          assert.equal(200, results[0].profit);
        });

    });
});
