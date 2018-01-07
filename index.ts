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
var apiPub = zaif.PublicApi;

// ローカルのdbを開く
var db     = new Datastore({filename: 'data/database.db', autoload: true});
var scores = new Datastore({filename: 'data/score.db',    autoload: true});

const DAYS4SCORING:number = 7; // 何日前までの取引履歴を成績として使うか
const AMOUNT:number = 1000; // 一度の取引で買う日本円金額

function check(){
  console.log(apiPub);
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

  // 新しい価格リストを受け取って、売り買いの判断をつける
  update(pair:string, now:Date, records:any, amount:number): void{
    const latest = records.reduce((x, y) => { return x.d > y.d ? x : y});
    if (this.has()){
      // 買っている場合->買い増すか売るか何もしないか)
      const sell:boolean = true
      if (sell){
        // 成行で売る=bidの価格で売ったことにする
        console.log("Sell:", pair, "for", latest.b, "yen from", this.average_price, "yen");
        // 結果をデータベースに記録する
        let score = {p: pair, param: this.param, d: now.getTime(), s: latest.b, b: this.average_price}; // day/pair/sell/buy
        scores.insert(score, (err) => {
          console.log("store:", score);
        });

        this.average_price = 0;
      }
    } else {
      // 買ってない場合->買うか何もしないか
      const buy:boolean = true
      if (buy && (amount > 0)){
        this.average_price = latest.a // 成行で買う=askの価格で買ったことにする
        const payment:number = latest.a * amount;
        console.log("Buy:", pair, "for", this.average_price, "*", amount, "=", payment, "yen");
      }
    }
  }
}

// 上のAgentを設定違いで複数個もって取引をシミュレートし、最適なものを実際の取引に使う
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

  update(records, amount:number): void{
    if(records.length == 0) return;

    const now = new Date();
    // シミュレーション取引用のエージェントを動かす
    for(let agent of this.agents){
      agent.update(this.pair, now, records, amount);
    }

    // これまでの各Agentのscoreを参照して、成績のよいものを本番取引に使う
    const daysAgoEpoch = now.getTime() - DAYS4SCORING*24*60*60*1000;
    for(let agent of this.agents){
      const query = {p: this.pair, param: agent.param, d: {$gte: daysAgoEpoch}}; // 直近DAYS4SCORING日の成績を検索するクエリ
      scores.find(query, (err, records) => {
        // 各scoreの損益を足し込む
        const profits = records.map((x) => {return x.s - x.b;}); // レコードごとの損益
        const profit  = profits.reduce((x, y) => { return x + y}, 0); // レコード全体の損益合計

        console.log("profit:", agent.param, this.pair, now, profit);
      });
    }
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

  // 価格情報の1レコードのjsonを作る
  makeRecord(pair, time, ticker): object{
    // date, currency_pair, ask: bit
    return {d: time, p: pair, a: ticker.ask, b: ticker.bid};
  }

  // 現在価格を取得して場合によっては取引する
  update(): void{
    for(let pair of this.pairs){
      let pairstr: string = pair.currency_pair;
      // 1. 価格を取得する
      // 本当はdepthを見てスプレッドを見た方がいい
      promiseRequestGet("https://api.zaif.jp/api/1/ticker/" + pairstr)
        .then((body:string) => {
          const ticker = JSON.parse(body);

          // 2. 自分のDBに記録する
          const now    = new Date();
          const record = this.makeRecord(pairstr, now.getTime(), ticker);

          console.log(dateFormat(now), pairstr, ": ask=" + ticker.ask, ", bid=" + ticker.bid);
          db.insert(record, (err) => {
            // 買う場合の購入数量を決める
            const amount:number = calcAmount(ticker.ask, AMOUNT, pair.item_unit_min, pair.item_unit_step);
            // 既存記録とレコードとまとめる
            const query = {p: pairstr};
            db.find(query, (err, records) => {
              // 各エージェントに判断を仰ぐ
              this.agents[pairstr].update(records, amount);
            });
          });
        })
        .catch((error) => {
          console.log("ERROR: promiseRequestGet", error);
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
