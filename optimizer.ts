var fs    = require('fs');
var yargs = require('yargs');

import {Link, Average} from "./avg";
import {PriceDB}       from "./price";
import {Agent}         from "./agent";
import {Util}          from "./util";

// 時間を進めていく間に、Agentごとに記憶しておく必要のある要素を構造体にまとめる
class Simulation{
  agent:Agent.Agent;
  pay:number;       // シミュレーション取引で買うために支払った量
  cc:number;        // シミュレーション取引で増減した仮想通貨の量
  profit:number;    // シミュレーション取引で確定させた損益の量
  prevAction:Agent.Action;

  constructor(param:Agent.Param){
    this.agent      = new Agent.Agent(param)
    this.pay        = 0;
    this.cc         = 0;
    this.profit     = 0;
    this.prevAction = Agent.Action.NONE;
  }

  // 最も長い移動平均を計算したいもののその個数を探す
  getLongestAvgRequest():number{
    return Math.max(this.agent.param.aas, this.agent.param.aal, this.agent.param.bas, this.agent.param.bal);
  }

  update(avg:Average, amount:number){
    // 作成した移動平均価格リストを使って
    const action:Agent.Action = this.agent.update(avg);

    if(action == Agent.Action.BUY && this.prevAction != action){
      // 新規に買い判定になったら買う
      this.cc  += amount;
      this.pay += Agent.calcPayment(avg.getAsk(), amount);;

    }else if(action == Agent.Action.SELL && this.prevAction != action){
      // 新規に売り判定になったら売る
      if(this.cc >= amount){
        const avgBuy:number = this.pay / this.cc; // この時点での平均買付額(この時点でcc >= amountであり常にcc > 0)
        this.profit += Agent.calcReceive(avg.getBid(), amount) - Math.round(amount * avgBuy);
        this.cc  -= amount;
        this.pay -= (amount * avgBuy);
      }
    }
    this.prevAction = action;
    return action;
  }

  static execute(param:Agent.Param, priceDB:PriceDB, amount:number): Agent.ParamProfit{
    let sim:Simulation = new Simulation(param);

    const maxLen:number = sim.getLongestAvgRequest();
    console.log(`max length of average prices needed: ${maxLen}`);

    // 価格履歴をたどって取引をシミュレートする
    let begin:number = priceDB.avgs.length - maxLen
    for(let i:number = begin; i>=0; --i){ // インクリメントに直したい
      const action = sim.update(priceDB.avgs[i], amount);

      const actionStr = (action == Agent.Action.BUY ? "buy" : (action == Agent.Action.SELL ? "sell" : ""))
      console.log(`time:${i}, action ${actionStr}`, priceDB.avgs[i].getAsk())
    }

    return new Agent.ParamProfit(param, sim.profit);
  }

}

// ある通貨ペアについて、上のAgentを設定違いで複数個もって取引をシミュレートし、最適なパラメータを推定する
class CCOptimize{
  params:  Agent.ParamProfit[]; // N個のエージェントパラメータ
  priceDB: PriceDB;
  constructor(private pairstr: string, private item_unit_min:number, private item_unit_step:number){
    this.params  = [];
    this.priceDB = new PriceDB(`data/price_${this.pairstr}.db`);
  }

  filepath():string{
    return `data/parameter_${this.pairstr}.json`;
  }

  prepareParam(){
    return new Promise((resolve, reject) => {
      if(this.params.length == 0){
        fs.readFile(this.filepath(), (err, data) => {
          if(err != null){
            for(let i=0; i<10; ++i){
              this.params.push(Agent.ParamProfit.makeRandom());
            }
          }else{
            // ファイル存在 -> 読む
            let params = JSON.parse(data).map((obj) => new Agent.ParamProfit(obj.param, obj.profit));
            this.params = params;
          }
          resolve();
        });
      } else {
        // 最良スコア以外を乱数で初期化
        for(let i=1; i<this.params.length; ++i){
          this.params[i] = Agent.ParamProfit.makeRandom();
        }
        resolve();
      }
    });
  }

  // 最新の価格+履歴を元に取引シミュレーションを行い、エージェントのパラメータを学習する
  loop1(){
    // 1. 最新価格の取得
    return this.priceDB.fetch(this.pairstr)
      .then(() => {
        // 2. パラメータの更新
        return this.prepareParam()
      })
      .then(() => {
        // 買う場合の購入数量を決める
        let amount:number = Util.calcAmount(this.priceDB.latest().ask, Util.AMOUNT, this.item_unit_min, this.item_unit_step);

        // シミュレーションで取引を実行し、結果を収集する
        let results = this.params.map((p) => Simulation.execute(p.param, this.priceDB, amount));
        results.sort((x, y) => {return y.profit - x.profit;});

        let best = results[0];
        // console.log(`${datelog()}\t${this.pair}\t best=${JSON.stringify(best.param)}\tprofit:${best.profit}`);
        for(let result of results){
          console.log(`${Util.datelog()}\t${this.pairstr}\t${JSON.stringify(result.param)}\tprofit:${result.profit}`);
        }

        // 成績順にソートしたエージェントを返してupdate終了
        return results;
      })
      .then((results:Agent.ParamProfit[]) => {
        fs.writeFileSync(this.filepath(), JSON.stringify(results));
      })
      .catch((error) => {
        console.log("ERROR: optimize", error);
      });
  }

  loop(){
    return this.loop1()
      .then(() => {
        // 無限ループ
        // setImmediate(() => {this.loop();});
        setTimeout(() => {this.loop();}, 1000);
      })
  }

}


//==============================================================================
// start
//==============================================================================
var argv = yargs
    .help   ('h').alias('h', 'help')
    .argv;

// エージェント最適化用のプロセス
// var params = JSON.parse(fs.readFileSync('./parameter.json', 'utf8'));
// パラメータを取得もしくは生成する
let pairs:any = JSON.parse(fs.readFileSync('pairs.json'));
pairs = pairs.filter((pair) => pair.currency_pair == "eth_jpy");  // test

var ccos = pairs.map((pair) => new CCOptimize(pair.currency_pair, pair.item_unit_min, pair.item_unit_step));

// 各エージェントで取引処理を動かす -> 成績を調べる
for(let cco of ccos){
  cco.loop();
}
