// リンクリスト
// そのままイテレータとして使いやすいようにあえて両端にemptyなLinkは持たない
// for文で回すときは返って使いづらいが…
export class Link{
  item:any;
  next:Link;
  prev:Link;
  constructor(item:any){
    this.item = item;
    this.next = null;
    this.prev = null;
  }

  // 自分の後ろに要素をつないで、後ろの要素を返す
  connect(nextItem:Link): Link{
    if(nextItem != null){
      this.next = nextItem;
      nextItem.prev = this;
    }
    return nextItem;
  }

  // 自分の手前の接続を切って、手前の要素を返す
  disconnect(): Link{
    let ret = null;
    if(this.prev != null){
      ret = this.prev;
      this.prev.next = null;
      this.prev = null;
    }
    return ret;
  }

  // 要素数を求める, オーダーN
  get length(): number{
    let len:number = 0;
    for(let l:Link = this; l != null; l = l.next){
      len += 1;
    }
    return len;
  }

  // arrayのmap関数と同じものをこのLinkでやる(結果はLinkでなくArray)
  // funcに渡される引数はitemではなくLinkそのもの
  map(func): any[]{
    let mapped:any[] = [];
    for(let l:Link = this; l != null; l = l.next){
      mapped.push(func(l));
    }
    return mapped;
  }

  // 末端を探す
  end(): Link{
    for(let endL:Link = this; endL != null; endL = endL.next){
      if(endL.next == null){
        return endL;
      }
    }
    return this;
  }

  static fromArray(items:any[]): Link{
    if (items.length >= 1){
      let ret = new Link(items[0]);
      let ptr = ret;
      for(let i=1; i<items.length; ++i){
        ptr = ptr.connect(new Link(items[i]));
      }
      return ret;
    } else {
      return null;
    }
  }

  static concat(a:Link, b:Link): Link{
    if (a == null) {
      return b;
    } else {
      a.end().connect(b);
      return a;
    }
  }
}

// ask/bidそれぞれの各時刻から過去に遡って移動平均を計算する
// 一度計算しておけば複数のエージェントのシミュレーション取引で使いまわせる
export class Average{
  askAvgs:number[];
  askPtr:Link;

  bidAvgs:number[];
  bidPtr:Link;

  // 新しい順に接続されている価格履歴リスト過去方向への移動平均価格を返せるオブジェクトを生成する
  constructor(priceLink:Link){
    this.askAvgs = [priceLink.item.ask];
    this.askPtr = priceLink.next;

    this.bidAvgs = [priceLink.item.bid];
    this.bidPtr = priceLink.next;
  }

  // 時刻-tから過去にn個分のaskの移動平均価格を返す(n>=1)
  getAskAvg(n:number): number{
    for(let i=this.askAvgs.length; i<n; ++i){
      if (this.askPtr == null) return this.askAvgs[this.askAvgs.length-1];
      this.askAvgs.push((this.askAvgs[i-1] * i + this.askPtr.item.ask) / (i+1));
      this.askPtr = this.askPtr.next;
    }
    return this.askAvgs[n>1 ? n-1 : 0];
  }

  // 時刻-tから過去にn個分のbidの移動平均価格を返す(n>=1)
  getBidAvg(n:number): number{
    for(let i=this.bidAvgs.length; i<n; ++i){
      if (this.bidPtr == null) return this.bidAvgs[this.bidAvgs.length-1];
      this.bidAvgs.push((this.bidAvgs[i-1] * i + this.bidPtr.item.bid) / (i+1));
      this.bidPtr = this.bidPtr.next;
    }
    return this.bidAvgs[n>1 ? n-1 : 0];
  }

  getAsk(): number{
    return this.getAskAvg(1);
  }

  getBid(): number{
    return this.getBidAvg(1);
  }
}
