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
    if (this.prices != null){
      return {"ask": this.avgs[0].getAsk(), "bid": this.avgs[0].getBid()};
    } else {
      return null;
    }
  }
}
