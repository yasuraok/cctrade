var fs    = require('fs');
var zaif  = require('zaif.jp');
var yargs = require('yargs');

import {Link, Average} from "./avg";
import {PriceDB}       from "./price";
import {Agent}         from "./agent";
import {Util}          from "./util";

// zaifに接続する
var config = JSON.parse(fs.readFileSync('./config.json'));
var apiPri = zaif.createPrivateApi(config.apikey, config.secretkey, 'user agent is node-zaif');

// 価格データベース
var priceDB = new PriceDB('data/price.db');

const AMOUNT:number = 10000; // 一度の取引で買う日本円金額
const THRESHOLD:number = 0; // 現在のパラメータの利益がこの数字よりも大きければ取引判断を実際に行う

function check(){
  console.log(apiPri);
}

// 現在の取引状況を取得する
function getStatus(){
  apiPri.getInfo().then(function(res){
      console.log(res)
  });
}

class CCWatch{
  pair:    any; // zaifから取れるjsonの情報
  param:   Agent.ParamProfit;
  priceDB: PriceDB;
  paramDB: Agent.ParamDB;

  constructor(pair:any){
    this.pair    = pair;
    this.param   = Agent.ParamProfit.makeRandom();
    this.priceDB = new PriceDB(`data/${pair.currency_pair}/price.db`);
    this.paramDB = new Agent.ParamDB(`data/${pair.currency_pair}/parameter.db`);
  }

  getParamFromFile(){
    return this.paramDB.find()
      .then((records) => {
        if (records.length > 0){
          return records[0];
        }else{
          return Agent.ParamProfit.makeRandom();
        }
      });
  }

  update(){
    let pairstr:string        = this.pair.currency_pair;
    let item_unit_min:number  = this.pair.item_unit_min;
    let item_unit_step:number = this.pair.item_unit_step;

    // 1. 価格を取得する
    // 本当はdepthを見てスプレッドを見た方がいい
    Util.promiseRequestGet("https://api.zaif.jp/api/1/ticker/" + pairstr)
      .then((body:string) => {
        const ticker = JSON.parse(body);
        const ratio:number = ticker.ask / ticker.bid;
        console.log(`${Util.datelog()}\t${pairstr}\task=${ticker.ask}\tbid=${ticker.bid}\t(${ratio})`);

        // DBに登録する
        return this.priceDB.insert(pairstr, ticker.ask, ticker.bid);
      })
      .then((price) => {
        // これまでの価格履歴を取得する
        return this.priceDB.fetch(pairstr);
      })
      .then(() => {
        // エージェントが稼働中であれば、取引判断をする
        if(this.param != null && this.param.profit > THRESHOLD){
          // 買う場合の購入数量を決める
          let latest = this.priceDB.latest();
          let amount = Util.calcAmount(latest.ask, AMOUNT, item_unit_min, item_unit_step);

          // エージェントに判断を仰ぐ
          // return this.agents[pairstr].update(latest, prices, amount);

          // if (sell){
          //   // 成行で売る=bidの価格で売ったことにする
          //   const receive:number = Math.floor(latest.bid * this.amount);
          //   const profit:number  = receive - this.payment;
          //   // console.log(`${datelog()}\t${this.pair}\t${JSON.stringify(this.param)}\tSell for ${latest.bid} yen * ${this.amount} (profit ${profit})`);
          //   // 結果をデータベースに記録する
          //   new Promise()
          //   return scoreDB.insert(this.pair, this.param, receive, this.payment)
          //     .then(() => {
          //       this.amount  = 0; // 価格を初期化
          //       this.payment = 0; // 価格を初期化
          //       return;
          //     })
          // }

          // if (){
          //   this.amount  = amount;
          //   this.payment = Math.ceil(latest.ask * amount); // 成行で買う=askの価格で買ったことにする
          //   // console.log(`${datelog()}\t${this.pair}\t${JSON.stringify(this.param)}\tBuy for ${latest.ask} * ${this.amount} = ${this.payment} yen`);
          // }

        }

        let x = false;
        if(x){
          // エージェントが取引中(=仮想通貨取得中)ならnullを返す(次のthenでパラメータを交換しない)
          return Promise.resolve(null);

        }else{
          // エージェントが取引中でなければ、optimizerで作った最適なパラメータを取得
          return this.getParamFromFile();
        }
      })
      .then((maybePP:Agent.ParamProfit) => {
        // optimizerで作った最新のパラメータに交換する (価格が更新されてるので、パラメータが変わらずスコアだけが変わっている可能性あり)
        if(maybePP != null){
          console.log(`${Util.datelog()}\t${pairstr}\tparameter updated \t(profit ${this.param.profit}=>${maybePP.profit})`);
          this.param = maybePP;
        }
      })
      .catch((error) => {
        console.log("ERROR: update", error);
        Util.notify2ifttt("error: ticker, " + pairstr, config.ifttt);
      });

  }
}

class CCWatchAll{
  readonly interval = 60 * 1000; // 監視タイム

  pairs: any;
  watchers: CCWatch[];
  constructor(){
    this.watchers = [];
  }

  // zaifで現在扱っている通貨ペアのリストを取得してコールバックを呼ぶ
  start(): void{
    Util.promiseRequestGet("https://api.zaif.jp/api/1/currency_pairs/all")
      .then((body:string) => {
        // 通貨ペア一覧からJPYのものだけを取り出す
        // "公開情報APIのcurrency_pairsで取得できるevent_numberが0であるものが指定できます" とのことなので
        // それもフィルタリングする
        this.pairs = JSON.parse(body).filter((element) => {
          const isJpy    = element.currency_pair.match("jpy");
          const isActive = element.event_number == 0;
          return isJpy && isActive;
        });

        // ファイルに書き出して、optimizerが見れるようにする
        fs.writeFileSync('pairs.json', JSON.stringify(this.pairs));
      })
      .then(() => {
        // 見つかった通貨ペアごとに取引プログラムを作って動かす
        this.watchers = this.pairs.map((pair) => new CCWatch(pair));

        // 監視スタート
        this.watch();
      })
      .catch((error) => {
        console.log("ERROR: promiseRequestGet", error);
      });
  }

  // 現在価格を取得して場合によっては取引する
  update(){
    for(let watcher of this.watchers){
      watcher.update();
    }
  }

  // 定期的に実行
  watch(): void{
    this.update()
    setInterval(() => {this.update()}, this.interval);
    // setInterval(() => {this.update()}, 200);
  }
}


//==============================================================================
// start
//==============================================================================
var argv = yargs
    .help   ('h').alias('h', 'help')
    .argv;

check();

// 価格取得&本番取引用のプロセス
var ccwa:CCWatchAll = new CCWatchAll();
ccwa.start();
