var MongoClient = require('mongodb').MongoClient;
import {Average} from "./avg";

//- aas: ask average short: 買う時の移動平均線の短い方の個数 (3)
//- aal: ask average long: 買う時の移動平均線の長い方の個数 (10)
//- ath: ask threashold: askの移動平均short/移動平均longがこの値を超えた時に買う
//- bas: bid average short: 売る時の移動平均線の短い方の個数 (3)
//- bal: bid average long: 売る時の移動平均線の長い方の個数 (10)
//- acr: ask to current raito: 購入価格に対する現在bid価格の比率, これを下回ると強制損切り (0.95)
//- spr: spread: 許容するask/bid値, これを下回らないと買わない (1.01)
export namespace Agent{
  export class Param{
    aas:number;
    aal:number;
    ath:number;
    bas:number;
    bal:number;
    spr:number;

    constructor(aas:number, aal:number, ath:number, bas:number, bal:number, spr:number){
      this.aas = aas;
      this.aal = aal;
      this.ath = ath;
      this.bas = bas;
      this.bal = bal;
      this.spr = spr;
    }

    static parse(obj): Param{
      return new Param(obj.aas, obj.aal, obj.ath, obj.bas, obj.bal, obj.spr);
    }

    static makeRandom(): Param{
      const aas:number = Math.floor(Math.random()*50 + 1);
      const aal:number = Math.floor(Math.random()*200 + 1);
      const ath:number = 1.0 + (Math.random()-0.5) * 0.2;
      const bas:number = Math.floor(Math.random()*50 + 1);
      const bal:number = Math.floor(Math.random()*200 + 1);
      const spr:number = 1.0 + Math.random() * 0.15;
      return new Param(aas, aal, ath, bas, bal, spr);
    }

    static equals(a:Param, b:Param){
      return (a.aas == b.aas) && (a.aal == b.aal) && (a.ath == b.ath) &&
             (a.bas == b.bas) && (a.bal == b.bal) && (a.spr == b.spr);
    }
  }

  // export function Param_make(aas:number, aal:number, ath:number, bas:number, bal:number, spr:number){
  //   let obj:Param = {aas:aas, aal:aal, ath:ath, bas:bas, bal:bal, spr:spr};
  //   return obj;
  // }
  //
  // export function makeRandomParam(){
  // }

  export class ParamProfit{
    param: Param;
    profit: number;
    constructor(param:Param, profit:number){
      this.param  = param;
      this.profit = profit;
    }

    toJSON(){
      return {param:this.param, profit:this.profit};
    }

    static parse(obj): ParamProfit{
      return new ParamProfit(obj.param, obj.profit);
    }

    static makeRandom(): ParamProfit{
      return new ParamProfit(Param.makeRandom(), 0);
    }
  }

  export enum Action{
    BUY,
    SELL,
    NONE,
  }

  // 自分のパラメータに基づいて判断をして売り買いを実行する
  // (買ってない場合->買うか何もしないか、買っている場合->買い増すか売るか何もしないか)
  // 移動平均など売り買いに必要な判断をつける
  export class Agent{
    // pair: string;
    // amount: number;  // 買い付けている時の買い付け量
    // payment: number; // 買い付けている時の支払い総額
    param: Param; // 自動売買の判断基準パラメータ

    constructor(param: Param){
      // this.pair    = pair;
      this.param   = param;
      // this.amount  = 0;
      // this.payment = 0;
    }

    // 買っている場合->買い増すか売るか何もしないか)
    trySell(avg:Average): Action{
      const avgShort:number = avg.getBidAvg(this.param.bas);
      const avgLong:number  = avg.getBidAvg(this.param.bal);

      return (avgShort <= avgLong) ? Action.SELL : Action.NONE;
    }

    // 買ってない場合->買うか何もしないか
    tryBuy(avg:Average) : Action{
      // askの価格を使って2つの移動平均線を作り、その短い方が高い値段になっているかを調べる
      const avgShort:number = avg.getAskAvg(this.param.aas);
      const avgLong:number  = avg.getAskAvg(this.param.aal);
      // console.log(avgShort, avgLong);

      const isSpreadSmall:boolean = (avg.getAsk() / avg.getBid()) <= this.param.spr;
      // console.log("SPREAD:", latest.ask, latest.bid, latest.ask / latest.bid, this.param.spr)
      const isAskRatioLarge:boolean = (avgShort / avgLong) >= this.param.ath;
       // console.log("ASKRATIO:", avgShort, avgLong, avgShort / avgLong, this.param.ath)
      return (isSpreadSmall && isAskRatioLarge) ? Action.BUY : Action.NONE;
    }

    // 新しい価格リストを受け取って、売り買いの判断をつける
    update(avg:Average) : Action{
      const mayBuy:Action = this.tryBuy(avg);
      if (mayBuy != Action.NONE){
        return mayBuy;
      } else {
        return this.trySell(avg);
      }
    }
  }

  export function calcPayment(ask:number, amount:number): number{
    return Math.ceil(ask * amount);
  }
  export function calcReceive(bid:number, amount:number): number{
    return Math.floor(bid * amount);
  }

  // Paramを複数プロセスから読み書きできるようにMongoDBで読み書きする
  // 複数プロセスからでも同時アクセス可能
  export class ParamDB{
    private db:any         = undefined;
    private dbo:any        = undefined;
    private collection:any = undefined;

    constructor(private url:string, private dbname:string, private pairstr:string){}

    connect(){
      if(this.collection == undefined){
        return MongoClient.connect(this.url)
          .then((db) => {
            this.db  = db;
            this.dbo = db.db(this.dbname)
            return this.dbo.createCollection(`${this.pairstr}_parameter`);
          })
          .then((collection) => {
            this.collection = collection;
            return;
          })
      } else {
        return Promise.resolve();
      }
    }

    // データベースに推定したパラメータセットをを書き込む
    // 過去のパラメータセットは不要なので同時に削除するが、先に削除すると一瞬レコード0の瞬間ができてしまうので
    // 新しいパラメータセット追加 -> 新しい順でfind -> 古いものを削除、という操作をする
    replace(records:any){
      var length = records.length;
      return this.connect()
        .then(() => {
          return this.collection.insertMany(records);
        })
        .then(() => {
          return this.collection.find().sort({ $natural: -1 }).toArray();
        })
        .then((results) => {
          let olds = results.slice(length, results.length);
          let deleteCond = { _id: {$in: olds.map((r) => r._id)} };
          return this.collection.deleteMany(deleteCond);
        });
    }

    // スコアの良い方から全件取得
    find(){
      return this.connect()
        .then(() => {
          return this.collection.find().sort({ profit: -1 }).toArray();
        })
    }
  }


} // namespace
