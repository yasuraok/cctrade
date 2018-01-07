var fs        = require('fs');
var request   = require('request');
var zaif      = require('zaif.jp');
var Datastore = require('nedb');
var decimal   = require('decimal');

function dateFormat(now){
  const Y = now.getFullYear();
  const M = now.getMonth() + 1;
  const D = now.getDate();
  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();
  return Y + "/" + M + "/" + D + " " + h + ":" + m + ":" + s;
}

// zaifに接続する
var config = JSON.parse(fs.readFileSync('./config.json'));
var apiPri = zaif.createPrivateApi(config.apikey, config.secretkey, 'user agent is node-zaif');

// 価格情報のDBのラッパー
// 非同期処理はpromise化しておく/findとinsertをこの機能に合わせた引数定義にする
class PriceDB{
  private db;
  constructor(filename:string){
    this.db = new Datastore({filename: filename, autoload: true});
  }

  // 価格情報の1レコードを作成して格納する
  insert(pair:string, ticker){
    return new Promise((resolve, reject) => {
      const record = {p: pair, d:new Date().getTime(), a: ticker.ask, b:ticker.bid}; // pair/date/ask/bid
      this.db.insert(record, (err) => {
        if (err == null) {
          resolve(record);
        } else {
          reject(err);
        }
      });
    });
  }

  // 価格一覧を取得する
  find(pair:string){
    return new Promise((resolve, reject) => {
      const query = {p: pair};
      this.db.find(query, (err, records) => {
        if (err == null) {
          resolve(records);
        } else {
          reject(err);
        }
      });
    });
  }
}
var prices = new PriceDB('data/database.db');

// 異なる判断規準で取引をするエージェント達のシミュレーション取引の結果を記録するDBのラッパー
// 非同期処理はpromise化しておく/findとinsertをこの機能に合わせた引数定義にする
class ScoreDB{
  private db;
  constructor(filename:string){
    this.db = new Datastore({filename: filename, autoload: true});
  }

  // 引数の成績を格納する
  insert(pair:string, param:AgentParam, sell:number, buy:number){
    return new Promise((resolve, reject) => {
      let score = {p: pair, param: param, d: new Date().getTime(), s: sell, b: buy};
      this.db.insert(score, (err) => {
        if (err == null) {
          resolve(score);
        } else {
          reject(err);
        }
      });
    });
  }

  // 直近DAYS4SCORING日の成績を検索する
  find(pair:string, param:AgentParam){
    return new Promise((resolve, reject) => {
      const daysAgoEpoch = new Date().getTime() - DAYS4SCORING*24*60*60*1000;
      const query = {p: pair, param: param, d: {$gte: daysAgoEpoch}};
      this.db.find(query, (err, records) => {
        if (err == null) {
          resolve(records);
        } else {
          reject(err);
        }
      });
    });
  }
}
var scores = new ScoreDB('data/score.db');


const DAYS4SCORING:number = 7; // 何日前までの取引履歴を成績として使うか
const AMOUNT:number = 1000; // 一度の取引で買う日本円金額

function check(){
  console.log(apiPri);
}

// 現在の取引状況を取得する
function getStatus(){
  apiPri.getInfo().then(function(res){
      console.log(res)
  });
}

// IFTTT経由でスマホに通知する
function notify2ifttt(message:string){
  var options = {
    uri: "https://maker.ifttt.com/trigger/cc/with/key/" + config.ifttt,
    headers: {
      "Content-type": "application/json",
    },
    json: {
      "value1": message,
      // "value2": "b"
    }
  };
  request.post(options, function(error, response, body){});
}

// promiseパターンでhttp getする
function promiseRequestGet(uri:string){
  return new Promise(function(resolve, reject){
    request.get({uri: uri}, (error, response, body) =>{
      if (!error && response.statusCode == 200) {
        resolve(body);
      } else {
        reject({error: error, status: response.statusCode});
      }
    });
  });
}

// ask円の通貨を、yen円内で最大でいくつ買えるかを計算する
// 購入する通貨最小値, 通貨入力単位による制限がある
function calcAmount(ask:number, yen:number, unitMin:number, unitStep:number){
  // (unitMin + unitStep * N)*ask <= yen を満たす最大のNを求め、unitMinとの和を返す
  if (yen/ask - unitMin > 0){
    let N:number = Math.floor((yen/ask - unitMin) / unitStep);
    // 普通に計算するとunitStep * N + unitMinで小数点誤差が乗るのでdecimalライブラリ経由で算出する
    return decimal(unitStep).mul(N).add(unitMin).toNumber();
  } else {
    return 0;
  }
}

// 自分のパラメータに基づいて判断をして売り買いを実行する
// (買ってない場合->買うか何もしないか、買っている場合->買い増すか売るか何もしないか)
// 移動平均など売り買いに必要な判断をつける
// 判断に基づいて売り買いを実行する
// 通知を入れる
interface AgentParam { [key:string]: number; }
function AgentParam_make(ass:number, aal:number, bas:number, bal:number, acr:number, spr:number){
  let obj:AgentParam = {ass:ass, aal:aal, bas:bas, bal:bal, acr:acr, spr:spr};
  return obj;
}


class Agent{
  average_price: number; // 買い付けている時の買い付け価格
  param: AgentParam; // 自動売買の判断基準パラメータ

  constructor(pair: string, param: AgentParam){
    this.param         = param;
    this.average_price = 0;
  }

  // 今買っているかどうか
  has(): boolean{
    return this.average_price > 0;
  }

  // 買っている場合->買い増すか売るか何もしないか)
  trySell(pair:string, latest:any, records:any){
    const sell:boolean = true
    if (sell){
      // 成行で売る=bidの価格で売ったことにする
      console.log("Sell:", pair, "for", latest.b, "yen from", this.average_price, "yen");
      // 結果をデータベースに記録する
      return scores.insert(pair, this.param, latest.b, this.average_price)
        .then(() => {
          this.average_price = 0; // 価格を初期化
          return;
        })
    }
    return Promise.resolve();
  }

  tryBuy(pair:string, latest:any, records:any, amount:number){
    // 買ってない場合->買うか何もしないか
    const buy:boolean = true
    if (buy && (amount > 0)){
      this.average_price = latest.a // 成行で買う=askの価格で買ったことにする
      const payment:number = latest.a * amount;
      console.log("Buy:", pair, "for", this.average_price, "*", amount, "=", payment, "yen");
    }
    return Promise.resolve();
  }

  // 新しい価格リストを受け取って、売り買いの判断をつける
  update(pair:string, latest:any, records:any, amount:number){
    return this.has() ? this.trySell(pair, latest, records) : this.tryBuy(pair, latest, records, amount);
  }
}

// ある通貨ペアについて、上のAgentを設定違いで複数個もって取引をシミュレートし、最適なものを実際の取引に使う
class Agents{
  active_index: number; // nullable
  agents: Agent[];
  pair: string;

  constructor(pair: string){
    this.pair   = pair;
    this.active_index = null;
    this.agents = [new Agent(pair, AgentParam_make(0,0,0,0,0,0))];
  }

  has(): boolean{
    return (this.active_index != null) && this.agents[this.active_index].has();
  }

  update(latest, records, amount:number){
    if(records.length == 0 || this.agents.length == 0) return;

    // 各エージェントで取引処理を動かす -> 成績を調べる
    let promises = this.agents.map((agent) => {
      // シミュレーション取引用のエージェントを動かす
      return agent.update(this.pair, latest, records, amount)
        .then(() => {
          // 過去も含む取引成績をDBから非同期で取得する
          return scores.find(this.pair, agent.param)
        })
        .then((records:any[]) => {
          // 各scoreの損益を足し込む
          const profits = records.map((x) => {return x.s - x.b;}); // レコードごとの損益
          const profit  = profits.reduce((x, y) => { return x + y}, 0); // レコード全体の損益合計

          return {param:agent.param, profit:profit};
        })
    });

    // 取得できたら、結果を元に最高評価のエージェントを本番用にセットする
    return Promise.all(promises)
      .then((results:any[]) => {
        for(let result of results){
          console.log("profit:", result.param, this.pair, result.profit);
        }
        let maxProfitAgent = results.reduce((x, y) => { return x.profit > y.profit ? x : y; });
        console.log("max: ", maxProfitAgent.param, maxProfitAgent.profit);
      })
      .catch((err) => {
        console.log(err);
      });
  }

  // 1エージェントの取引成績を計算するpromise
  // agentと成績=profitのペアを返す
  calcScore(pair:string, param:AgentParam) {
  }
}



class CCWatch{
  readonly interval = 60 * 1000; // 監視タイム

  pairs: any;
  agents: { [key: string]: Agents};
  constructor(){
    this.agents = {};
  }

  // zaifで現在扱っている通貨ペアのリストを取得してコールバックを呼ぶ
  start(): void{
    promiseRequestGet("https://api.zaif.jp/api/1/currency_pairs/all")
      .then((body:string) => {
        // 通貨ペア一覧からJPYのものだけを取り出す
        // "公開情報APIのcurrency_pairsで取得できるevent_numberが0であるものが指定できます" とのことなので
        // それもフィルタリングする
        this.pairs = JSON.parse(body).filter((element) => {
          const isJpy    = element.currency_pair.match("jpy");
          const isActive = element.event_number == 0;
          return isJpy && isActive;
        });

        // 見つかった通貨ペアごとにエージェントを用意する
        for(let pair of this.pairs){
          let pairstr: string = pair.currency_pair;
          if(! (pairstr in this.agents)){
            this.agents[pairstr] = new Agents(pairstr);
          }
        }

        // 監視スタート
        this.watch();
      })
      .catch((error) => {
        console.log("ERROR: promiseRequestGet", error);
      });
  }

  // 現在価格を取得して場合によっては取引する
  update(){
    for(let pair of this.pairs){
      let pairstr:string = pair.currency_pair;
      let amount:number = 0; // promise内で代入
      let latest:any;        // 最新価格: promise内で代入

      // 1. 価格を取得する
      // 本当はdepthを見てスプレッドを見た方がいい
      promiseRequestGet("https://api.zaif.jp/api/1/ticker/" + pairstr)
        .then((body:string) => {
          const ticker = JSON.parse(body);

          console.log(dateFormat(new Date()), pairstr, ": ask=" + ticker.ask, ", bid=" + ticker.bid);

          // 買う場合の購入数量を決める
          amount = calcAmount(ticker.ask, AMOUNT, pair.item_unit_min, pair.item_unit_step);
          // DBに登録する
          return prices.insert(pairstr, ticker);
        })
        .then((record) => {
          latest = record;
          // これまでの価格履歴を取得する
          return prices.find(pairstr);
        })
        .then((records) => {
          // 各エージェントに判断を仰ぐ
          return this.agents[pairstr].update(latest, records, amount);
        })
        .catch((error) => {
          console.log("ERROR: update", error);
          notify2ifttt("error: ticker, " + pairstr);
        });
    }
  }

  // 定期的に実行
  watch(): void{
    this.update()
    setInterval(() => {this.update()}, this.interval);
  }
}


check();
// notify2ifttt();
// currencies_all();

var ccw:CCWatch = new CCWatch();

ccw.start();
