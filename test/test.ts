import {Link, Average} from "../avg";
import {PriceDB}       from "../price";

var assert = require('assert');
var fs     = require('fs');
import * as mocha from "mocha";

////////////////////////////////////////////////////////////////////////////////

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
      const testPair:string = "test";
      const dbPath:string = `data/price_${testPair}.db`;
      fs.unlinkSync(dbPath); // 先に削除

      const ask1:number = 400;
      const ask2:number = 420;
      const ask3:number = 450;
      const bid1:number = 350;
      const bid2:number = 370;
      const bid3:number = 320;

      var priceDB = new PriceDB(dbPath);
      return priceDB.insert(testPair, ask1, bid1)
        .then((result) => {
        return new Promise(r => setTimeout(r, 200)); // 待つ
      }).then(() => {
        return priceDB.insert(testPair, ask2, bid2);
      }).then((result) => {
        return priceDB.fetch(testPair);
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
        return priceDB.fetch(testPair);
      }).then(() => {
        assert.equal(3, priceDB.prices.length);
        assert.equal(3, priceDB.avgs.length);
        assert.equal(ask3, priceDB.avgs[0].getAskAvg(1)); // この時点での最新はask3
        assert.equal((bid2 + bid1) / 2, priceDB.avgs[1].getBidAvg(2)); // 最新から1時刻過去データから2時刻分の移動平均
        return;
      });
    });
});
