var fs        = require('fs');
var request   = require('request');
var zaif      = require('zaif.jp');
var Datastore = require('nedb');
var decimal   = require('decimal');
var Realm     = require('realm');
var yargs     = require('yargs');

function dateFormat(now){
  const Y = now.getFullYear();
  const M = now.getMonth() + 1;
  const D = now.getDate();
  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();
  return Y + "/" + M + "/" + D + " " + h + ":" + m + ":" + s;
}

function datelog(){
  return dateFormat(new Date())
}

// zaifに接続する
var config = JSON.parse(fs.readFileSync('./config.json'));
var apiPri = zaif.createPrivateApi(config.apikey, config.secretkey, 'user agent is node-zaif');

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

class PriceDB{
  private db;
  constructor(filename:string){
    this.db = new Realm({path: filename, schema: [SCHEMA]});
  }

  // 価格情報の1レコードを作成して格納する
  insert(pair:string, ticker){
    return new Promise((resolve, reject) => {
      const record = {pair: pair, date:new Date(), ask: ticker.ask, bid:ticker.bid}; // pair/date/ask/bid
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
}
var priceDB = new PriceDB('data/price.db');

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
var scoreDB = new ScoreDB('data/score.db');


const DAYS4SCORING:number = 7; // 何日前までの取引履歴を成績として使うか
const AMOUNT:number = 10000; // 一度の取引で買う日本円金額

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
        reject(error);
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


//- aas: ask average short: 買う時の移動平均線の短い方の個数 (3)
//- aal: ask average long: 買う時の移動平均線の長い方の個数 (10)
//- ath: ask threashold: askの移動平均short/移動平均longがこの値を超えた時に買う
//- bas: bid average short: 売る時の移動平均線の短い方の個数 (3)
//- bal: bid average long: 売る時の移動平均線の長い方の個数 (10)
//- acr: ask to current raito: 購入価格に対する現在bid価格の比率, これを下回ると強制損切り (0.95)
//- spr: spread: 許容するask/bid値, これを下回らないと買わない (1.01)
interface AgentParam { [key:string]: number; }
function AgentParam_make(aas:number, aal:number, ath:number, bas:number, bal:number, spr:number){
  let obj:AgentParam = {aas:aas, aal:aal, ath:ath, bas:bas, bal:bal, spr:spr};
  return obj;
}

// 自分のパラメータに基づいて判断をして売り買いを実行する
// (買ってない場合->買うか何もしないか、買っている場合->買い増すか売るか何もしないか)
// 移動平均など売り買いに必要な判断をつける
// 判断に基づいて売り買いを実行する
// 通知を入れる
class Agent{
  pair: string;
  amount: number;  // 買い付けている時の買い付け量
  payment: number; // 買い付けている時の支払い総額
  param: AgentParam; // 自動売買の判断基準パラメータ

  constructor(pair: string, param: AgentParam){
    this.pair    = pair;
    this.param   = param;
    this.amount  = 0;
    this.payment = 0;
  }

  // 今買っているかどうか
  has(): boolean{
    return this.amount > 0;
  }

  // 買っている場合->買い増すか売るか何もしないか)
  trySell(latest:any, prices:any){
    // bidの価格を使って2つの移動平均線を作り、その短い方が高い値段になっているかを調べる
    if (prices.length >= this.param.bal){
      const bas:number = this.param.bas;
      const bal:number = this.param.bal;
      const bids:number[] = prices.slice(0, bal).map((r) => r.bid); // bidの価格を使う
      const avgShort:number = bids.slice(0, bas).reduce((x,y) => x+y) / bas;
      const avgLong:number  = bids              .reduce((x,y) => x+y) / bal;
      const sell:boolean = avgShort <= avgLong;

      if (sell){
        // 成行で売る=bidの価格で売ったことにする
        const receive:number = Math.floor(latest.bid * this.amount);
        const profit:number  = receive - this.payment;
        console.log(`${datelog()}\t${this.pair}\t${JSON.stringify(this.param)}\tSell for ${latest.bid} yen * ${this.amount} (profit ${profit})`);
        // 結果をデータベースに記録する
        return scoreDB.insert(this.pair, this.param, receive, this.payment)
          .then(() => {
            this.amount  = 0; // 価格を初期化
            this.payment = 0; // 価格を初期化
            return;
          })
      }
    }
    return Promise.resolve();
  }

  // 買ってない場合->買うか何もしないか
  tryBuy(latest:any, prices:any, amount:number){
    // askの価格を使って2つの移動平均線を作り、その短い方が高い値段になっているかを調べる
    if (prices.length >= this.param.aal){
      const aas:number = this.param.aas;
      const aal:number = this.param.aal;
      const asks:number[] = prices.slice(0, aal).map((r) => r.ask); // askの価格を使う
      const avgShort:number = asks.slice(0, aas).reduce((x,y) => x+y) / aas;
      const avgLong:number  = asks              .reduce((x,y) => x+y) / aal;

      const isSpreadSmall:boolean = (latest.ask / latest.bid) <= this.param.spr;
      // console.log("SPREAD:", latest.ask, latest.bid, latest.ask / latest.bid, this.param.spr)
      const isAskRatioLarge:boolean = (avgShort / avgLong) >= this.param.ath;
      // console.log("ASKRATIO:", avgShort, avgLong, avgShort / avgLong, this.param.ath)

      if (isSpreadSmall && isAskRatioLarge && (amount > 0)){
        this.amount  = amount;
        this.payment = Math.ceil(latest.ask * amount); // 成行で買う=askの価格で買ったことにする
        console.log(`${datelog()}\t${this.pair}\t${JSON.stringify(this.param)}\tBuy for ${latest.ask} * ${this.amount} = ${this.payment} yen`);
      }
    }
    return Promise.resolve();
  }

  // 新しい価格リストを受け取って、売り買いの判断をつける
  update(latest:any, prices:any, amount:number){
    return this.has() ? this.trySell(latest, prices) : this.tryBuy(latest, prices, amount);
  }
}

// ある通貨ペアについて、上のAgentを設定違いで複数個もって取引をシミュレートし、最適なものを実際の取引に使う
class Agents{
  agents: Agent[];
  pair: string;

  constructor(pair: string, params:AgentParam[]){
    this.pair   = pair;
    this.agents = params.map((param) => new Agent(pair, param));
  }

  update(latest, prices, amount:number){
    if(this.agents.length == 0) return;

    // 各エージェントで取引処理を動かす -> 成績を調べる
    let promises = this.agents.map((agent) => {
      // シミュレーション取引用のエージェントを動かす
      return agent.update(latest, prices, amount)
        .then(() => {
          // 過去も含む取引成績をDBから非同期で取得する
          return scoreDB.find(this.pair, agent.param)
        })
        .then((scores:any[]) => {
          // 各scoreの損益を足し込む
          const profits = scores.map((x) => {return x.s - x.b;}); // レコードごとの損益
          const profit  = profits.reduce((x, y) => { return x + y}, 0); // レコード全体の損益合計

          return {param:agent.param, profit:profit};
        })
    });

    // 取得できたら、結果を元に最高評価のエージェントを本番用にセットする
    return Promise.all(promises)
      .then((results:any[]) => {
        let bestAgent = results.reduce((x, y) => { return x.profit > y.profit ? x : y; });
        for(let result of results){
          const best:string = result.param == bestAgent.param ? "(best)" : "";
          console.log(`${datelog()}\t${this.pair}\t${JSON.stringify(result.param)}\tprofit:${result.profit}\t${best}`);
        }
      })
      .catch((err) => {
        console.log(err);
      });
  }
}



class CCWatch{
  readonly interval = 60 * 1000; // 監視タイム

  pairs: any;
  agents: { [key: string]: Agent };
  constructor(){
    this.agents = {};
  }

  // zaifで現在扱っている通貨ペアのリストを取得してコールバックを呼ぶ
  start(params:AgentParam[]): void{
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

        // ファイルに書き出して、optimizerが見れるようにする
        fs.writeFileSync('pairs.json', JSON.stringify(this.pairs));
      })
      .then(() => {
        // 見つかった通貨ペアごとにエージェントを用意する
        for(let pair of this.pairs){
          let pairstr: string = pair.currency_pair;
          this.agents[pairstr] = new Agent(pairstr, params[0]);
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

      // 1. 価格を取得する
      // 本当はdepthを見てスプレッドを見た方がいい
      promiseRequestGet("https://api.zaif.jp/api/1/ticker/" + pairstr)
        .then((body:string) => {
          const ticker = JSON.parse(body);
          const ratio:number = ticker.ask / ticker.bid;
          console.log(`${datelog()}\t${pairstr}\task=${ticker.ask}\tbid=${ticker.bid}\t(${ratio})`);

          // DBに登録する
          return priceDB.insert(pairstr, ticker);
        })
        .then((price) => {
          // これまでの価格履歴を取得する
          return priceDB.find(pairstr);
        })
        .then((prices:any[]) => {
          // 買う場合の購入数量を決める
          let latest = prices[0];
          let amount = calcAmount(latest.ask, AMOUNT, pair.item_unit_min, pair.item_unit_step);
          // エージェントに判断を仰ぐ
          return this.agents[pairstr].update(latest, prices, amount);

          // // 本番エージェントが不在または取引中でなければ、エージェントの交換を試みる
          // if(this.realAgent == null || (! this.realAgent.has())){
          //   if(bestAgent.profit >= 0){
          //     this.realAgent = new Agent(this.pair, bestAgent.param);
          //   } else {
          //     this.realAgent = null; // 全員成績が悪い時はお休み
          //   }
          // }
          //
          // // 本番エージェントを稼働
          // if(this.realAgent != null){
          //   return this.realAgent.update(latest, prices, amount);
          // }

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


class CCOptimize{
  agents: { [key: string]: Agents};
  params: AgentParam[];
  constructor(params:AgentParam[]){
    this.params = params;
    this.agents = {};
  }

  // 最新の価格+履歴を元に取引シミュレーションを行い、エージェントのパラメータを学習する
  loop(){
    let pairs:any = JSON.parse(fs.readFileSync('pairs.json'));

    // 各エージェントで取引処理を動かす -> 成績を調べる
    let promises = pairs.map((pair) => {
      let pairstr:string = pair.currency_pair;
      let agents:Agents  = new Agents(pairstr, this.params);

      // 1. 価格を取得する
      return priceDB.find(pairstr)
        .then((prices:any[]) => {

          if (prices.length > 0){
            // 買う場合の購入数量を決める
            let latest = prices[0];
            let amount:number = calcAmount(latest.ask, AMOUNT, pair.item_unit_min, pair.item_unit_step);

            // 各エージェントに判断を仰ぐ
            return agents.update(latest, prices, amount);
          }
        })
        .catch((error) => {
          console.log("ERROR: optimize", error);
        });
    });

    // 取得できたら、結果を元に最高評価のエージェントを本番用にセットする
    return Promise.all(promises)
    .then(() => {
      // 無限ループ
      setImmediate(() => {this.loop();});
    });
  }

}


//==============================================================================
// start
//==============================================================================
var argv = yargs
    .help   ('h').alias('h', 'help')
    .boolean('o').alias('o', 'optimize').default('o', false)
    .argv;

check();

if (argv.optimize){
  // エージェント最適化用のプロセス
  var params = JSON.parse(fs.readFileSync('./parameter.json', 'utf8'));
  var cco:CCOptimize = new CCOptimize(params);
  cco.loop();

} else {
  // 価格取得&本番取引用のプロセス
  var params = JSON.parse(fs.readFileSync('./parameter.json', 'utf8'));
  var ccw:CCWatch = new CCWatch();
  ccw.start(params);
}
