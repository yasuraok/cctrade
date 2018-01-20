var Realm     = require('realm');

import {Link, Average} from "./avg";

// 価格情報のDBのラッパー
// 非同期処理はpromise化しておく/findとinsertをこの機能に合わせた引数定義にする
const SCHEMA = {
  name: 'price',         // オブジェクト名
  properties: {          // オブジェクトスキーマの定義
      pair: 'string',
      date: 'date',
      ask: 'double',
      bid: 'double'
  }
}

export class PriceDB{
  private db;
  private lastDate: Date; // 取得した価格履歴のうち最新の日付
  prices:Link;
  avgs:Average[];

  constructor(filename:string){
    this.db = new Realm({path: filename, schema: [SCHEMA]});
    this.lastDate = new Date(0);
    this.prices = null;
    this.avgs   = [];
  }

  // 価格情報の1レコードを作成して格納する
  insert(pair:string, ask:number, bid:number, date:Date = null){
    if(date == null) date = new Date();
    return new Promise((resolve, reject) => {
      const record = {pair: pair, date: date, ask: ask, bid: bid}; // pair/date/ask/bid
      this.db.write(() => {
        // オブジェクト登録
        this.db.create(SCHEMA.name, record);
        resolve(record);
      });
    });
  }

  // 価格一覧を取得する(新しい順にソートしておく)
  find(pair:string){
    return new Promise((resolve, reject) => {
      let all    = this.db.objects(SCHEMA.name);
      let results = all.filtered("pair == $0", pair).sorted('date', true);
      // results.forEach((val, key) => {
      //   console.log(`${val.pair}, ${dateFormat(val.date)}, ${val.ask}, ${val.bid}`);
      // });
      resolve(results);
    });
  }

  // 最新の価格一覧を取得して価格をリンクリストに、さらに価格のリンクリストの先に移動平均価格の配列を作って返す
  fetch(pair:string){
    return new Promise((resolve, reject) => {
      let all    = this.db.objects(SCHEMA.name);
      let results = all.filtered("pair == $0 && date > $1", pair, this.lastDate).sorted('date', true);
      // results.forEach((val, key) => {
      //   console.log(`${val.pair}, ${dateFormat(val.date)}, ${val.ask}, ${val.bid}`);
      // });
      resolve(results);
    }).then((newPrices:any[]) => {
      if (newPrices.length > 0){
        let length       = newPrices.length;
        let newPriceList = Link.fromArray(newPrices);
        let newAvgs      = newPriceList.map((listNode) => new Average(listNode));

        // 価格リストの更新
        this.prices = Link.concat(newPriceList, this.prices);
        // 移動平均価格リストの更新
        this.avgs   = newAvgs.concat(this.avgs); // 連結
        // this.prices, this.avgsの最終更新時刻の更新
        this.lastDate = newPrices[0].date;

        // 長さを詰める

      }
      return;
    })
  }

  latest(){
    return {"ask": this.avgs[0].getAsk(), "bid": this.avgs[0].getBid()};
  }
}

////////////////////////////////////////////////////////////////////////////////

var assert = require('assert');
var fs     = require('fs');
import * as mocha from "mocha";

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
        console.log(`priceDB.avgs=${priceDB.avgs}, length=${priceDB.avgs.length}`)
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
