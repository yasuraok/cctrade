var MongoClient = require('mongodb').MongoClient;

import {Link, Average} from "./avg";

// Linkの末端からn個取り外す
function deleteN(l:Link, n:number){
  let end = l.end();
  for(let i=0; i<n && end != null; ++i){
    end = end.disconnect();
  }
}

export class PriceDB{
  private db:any         = undefined;
  private dbo:any        = undefined;
  private collection:any = undefined;

  private lastDate: Date; // 取得した価格履歴のうち最新の日付
  prices:Link;
  avgs:Average[];

  constructor(private url:string, private dbname:string, private pairstr:string){
    this.lastDate = new Date(0);
    this.prices = null;
    this.avgs   = [];
  }

  connect(){
    if(this.collection == undefined){
      return MongoClient.connect(this.url)
        .then((db) => {
          this.db  = db;
          this.dbo = db.db(this.dbname)
          return this.dbo.createCollection(`${this.pairstr}_price`);
        })
        .then((collection) => {
          this.collection = collection;
          return;
        })
    } else {
      return Promise.resolve();
    }
  }

  // 価格情報の1レコードを作成して格納する
  insert(pair:string, ask:number, bid:number, date:Date = null){
    if(date == null) date = new Date();
    return this.connect()
      .then(() => {
        const record = {pair: pair, date: date, ask: ask, bid: bid}; // pair/date/ask/bid
        return this.collection.insertOne(record);
      });
  }

  // 最新の価格一覧を取得して価格をリンクリストに、さらに価格のリンクリストの先に移動平均価格の配列を作って返す
  fetch(pair:string, limit:number){
    return this.connect()
      .then(() => {
        // この通貨の、新しい価格のみを取得
        let query  = { pair: pair, date: {$gt: this.lastDate} }
        // 結果を新しい順にソートし、limit個までを返す
        return this.collection.find(query).sort({date: -1}).limit(limit).toArray();
      })
      .then((newPrices:any[]) => {
        if (newPrices.length > 0){
          let newPriceList = Link.fromArray(newPrices);
          let newAvgs      = newPriceList.map((listNode) => new Average(listNode));

          // 新しいレコードの連結
          this.prices  = Link.concat(newPriceList, this.prices); // 価格リストの更新
          this.avgs    = newAvgs.concat(this.avgs); // 移動平均価格リストの更新

          // 古いレコードの削除
          this.prices = this.prices.slice(0, limit);
          this.avgs   = this.avgs  .slice(0, limit);

          // this.prices, this.avgsの最終更新時刻の更新
          this.lastDate = newPrices[0].date;
        }
        return;
      });
  }

  latest(){
    if (this.prices != null){
      return {"ask": this.avgs[0].getAsk(), "bid": this.avgs[0].getBid()};
    } else {
      return null;
    }
  }

  // DBからレコードを全て削除する。デバッグ用
  clear(){
    console.log("clear")
    return this.connect()
      .then(() => {
        return this.collection.deleteMany({});
      })
      .then(() => {
        this.lastDate = new Date(0);
        this.prices = null;
        this.avgs   = [];
        return;
      });
  }
}
