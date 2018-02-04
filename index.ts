var fs    = require('fs');
var zaif  = require('zaif.jp');
var yargs = require('yargs');

import {Link, Average} from "./avg";
import {PriceDB}       from "./price";
import {Agent}         from "./agent";
import {Util}          from "./util";

// zaifに接続する
let config = JSON.parse(fs.readFileSync('./config.json'));
let apiPri = zaif.createPrivateApi(config.apikey, config.secretkey, 'user agent is node-zaif');

// 価格データベース
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

// Agentに取引判断をさせ、売買金額を記憶する
class AgentScore{
  agent:Agent.Agent;
  yen:number;       // 取引で増減した円の量
  cc:number;        // 取引で増減した仮想通貨の量
  prevAction:Agent.Action;

  constructor(param:Agent.Param){
    this.agent      = new Agent.Agent(param)
    this.yen        = 0;
    this.cc         = 0;
    this.prevAction = Agent.Action.NONE;
  }

  setParam(param:Agent.Param){
    this.agent = new Agent.Agent(param)
  }

  // 成績をクリアする
  clear(){
    this.yen    = 0
    this.cc     = 0
  }

  update(avg:Average, amount:number){
    // 作成した移動平均価格リストを使って
    const action:Agent.Action = this.agent.update(avg);

    let retAction = Agent.Action.NONE;

    if(action == Agent.Action.BUY && this.prevAction != action){
      // 新規に買い判定になったら買う
      this.cc  += amount;
      this.yen -= Agent.calcPayment(avg.getAsk(), amount);;
      retAction = Agent.Action.BUY;

    }else if(action == Agent.Action.SELL && this.prevAction != action){
      // 新規に売り判定になったら売る
      this.cc  -= amount;
      this.yen += Agent.calcReceive(avg.getBid(), amount);
      retAction = Agent.Action.SELL;
    }

    this.prevAction = action;

    return retAction;
  }

  // 取引中かどうか(取引中でなければパラメータを交換して良い)
  isLong(): boolean{
    return this.cc > 0;
  }
}

function showTrade(pair:any, action:string, avg:Average, cc:number, yen:number, iftttKey:string){
  cc                = Util.fixupFloat(cc, pair.item_unit_step); // 誤差を補正
  let pairstr       = pair.currency_pair;
  let bid:number    = avg.getBid();
  let income:number = yen + Agent.calcReceive(avg.getBid(), cc);
  let strs = [pairstr, action, `yen=${yen}`, `cc=${cc}*${bid}`, `income=${income}`];
  console.log(Util.datelog() + "\t" + strs.join("\t"));
  Util.notify2ifttt(strs.join(", "), config.ifttt);
}

class CCWatch{
  pair:    any; // zaifから取れるjsonの情報
  param:   Agent.ParamProfit;
  priceDB: PriceDB;
  paramDB: Agent.ParamDB;
  agentScore: AgentScore;

  constructor(pair:any){
    this.pair    = pair;
    this.param   = Agent.ParamProfit.makeRandom();
    let mongoUrl = `mongodb://${config.mongo_url}:${config.mongo_port}/`;
    this.priceDB = new PriceDB(mongoUrl, config.mongo_dbname, pair.currency_pair);
    this.paramDB = new Agent.ParamDB(mongoUrl, config.mongo_dbname, pair.currency_pair);
    this.agentScore = new AgentScore(this.param.param);
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
        const limit = Util.DAYS4SCORING * 24 * 60;
        return this.priceDB.fetch(pairstr, limit);
      })
      .then(() => {
        // エージェントが稼働中であれば、取引判断をする
        if(this.param != null && this.param.profit > THRESHOLD){
          // 買う場合の購入数量を決める
          let latest = this.priceDB.latest();
          let amount = Util.calcAmount(latest.ask, AMOUNT, item_unit_min, item_unit_step);

          // エージェントに判断を仰ぐ
          let avg = this.priceDB.avgs[0];
          let action:Agent.Action = this.agentScore.update(avg, amount);

          if(action == Agent.Action.BUY){
            // 買い取引を実行する
            // showTrade(pairstr, "BUY", avg, this.agentScore.cc, this.agentScore.yen, config.ifttt);

          }else if(action == Agent.Action.SELL){
            // 売り取引を実行する
            // 通知する
            showTrade(this.pair, "SELL", avg, this.agentScore.cc, this.agentScore.yen, config.ifttt);
          }

          // ここでyen -= profitすれば、含み益分を一旦クリアできるはず
        }

        if(this.agentScore.isLong()){
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
          if(! Agent.Param.equals(this.param.param, maybePP.param)){
            console.log(`${Util.datelog()}\t${pairstr}\tparameter updated \t(simulation profit ${this.param.profit}=>${maybePP.profit})`);
          }
          this.param = maybePP;
          this.agentScore.setParam(this.param.param);
        }
      })
      .catch((error) => {
        console.log(`${Util.datelog()}: ERROR, ${pairstr}`, error);
        Util.notify2ifttt(`ERROR, ${pairstr}, ${error}`, config.ifttt);
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
