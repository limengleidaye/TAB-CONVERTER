/**
 * 播放窗的声音：合成的箫音 / 钢琴音 + 节拍器。全部用 WebAudio 现场合成，不带任何音频素材。
 *
 * 箫是端吹的气鸣乐器，波形上有三个特征，缺一个听起来就像电子琴：
 *   1. 基频占绝对主导，二次谐波弱、三次更弱（不是锯齿波那种满谐波）；
 *   2. 起音软（约 60ms 的气流建立），不是拨弦那样的瞬态；
 *   3. 始终带一层气声——一路带通白噪，中心跟着音高走。
 * 再加约 5Hz、延迟进入的轻微颤音，就有吹管的味道了。
 *
 * 钢琴是击弦，几乎处处相反：起音只有几毫秒、没有持续段（按住也一直在衰减）、
 * 谐波多且**高次衰减得更快**（所以音头亮、尾巴闷），弦的刚度还让泛音略高于整数倍。
 * 这里用「一排微微失谐的正弦 + 随时间关下来的低通 + 指数衰减包络 + 一记槌击噪声」逼近。
 */

export type Instrument = 'xiao' | 'piano'

/** 一次起吹的三条振荡器：基频 / 二次 / 三次谐波的相对音量 */
const PARTIALS: readonly { ratio: number; gain: number }[] = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.13 },
  { ratio: 3, gain: 0.045 },
]

const ATTACK = 0.055
const RELEASE = 0.09
const BREATH_GAIN = 0.05
const VIBRATO_HZ = 4.8
/** 颤音深度（相对音高的比例）与进入延迟：一起音就抖会很假 */
const VIBRATO_DEPTH = 0.005
const VIBRATO_DELAY = 0.22

const PIANO_ATTACK = 0.004
/** 松开琴键后制音器落下的时间 */
const PIANO_DAMP = 0.12
const PIANO_PARTIALS = 7
/** 弦的刚度系数：泛音被拉高一丝丝 */
const PIANO_INHARMONICITY = 0.0004

/** 自由衰减到几乎听不见要多久：低音拖得长，高音一下就没 */
function decayOf(freq: number): number {
  return Math.min(6, Math.max(0.5, 900 / freq))
}

export class PlaybackAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  /** 已排期、还没响完的节点，暂停/拖动进度条时要就地掐掉 */
  private live: { source: AudioScheduledSourceNode; gain: GainNode }[] = []

  /** 必须在用户手势里调用（浏览器的自动播放策略） */
  async resume(): Promise<void> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.9
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

  get available(): boolean {
    return !!this.ctx
  }

  /** 音频时钟（秒）。调度一律用它，不要用 performance.now —— 两个时钟会慢慢漂开 */
  get now(): number {
    return this.ctx?.currentTime ?? 0
  }

  /** 排一个音；at 为音频时钟上的绝对时间 */
  note(freq: number, at: number, duration: number, instrument: Instrument = 'xiao', volume = 0.5): void {
    if (this.isPast(at)) return
    if (instrument === 'piano') this.piano(freq, at, duration, volume)
    else this.xiao(freq, at, duration, volume)
  }

  /**
   * 时间已经过去的音一律丢弃，而不是夹到「现在」补响。
   * 从后台切回来、或主线程卡顿之后，会一次性补排一大批早就该响的音——
   * 把它们挪到当下，就是所有音一起炸响。
   */
  private isPast(at: number): boolean {
    return !!this.ctx && at < this.ctx.currentTime - 0.02
  }

  private xiao(freq: number, at: number, duration: number, volume: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master || duration <= 0) return

    const start = Math.max(at, ctx.currentTime)
    // 时值短于起音+收音时，把包络压扁，免得短音听不见头
    const body = Math.max(duration, ATTACK + RELEASE + 0.02)
    const end = start + body

    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, start)
    env.gain.exponentialRampToValueAtTime(volume, start + Math.min(ATTACK, body * 0.4))
    env.gain.setValueAtTime(volume, Math.max(start + ATTACK, end - RELEASE))
    env.gain.exponentialRampToValueAtTime(0.0001, end)

    // 管体共鸣：把高次谐波压掉一截，声音才不刺
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = Math.min(9000, freq * 6)
    tone.Q.value = 0.4
    tone.connect(env)
    env.connect(this.master)

    // 颤音：一个 LFO 同时推三条振荡器的频率
    const lfo = ctx.createOscillator()
    lfo.frequency.value = VIBRATO_HZ
    const lfoGain = ctx.createGain()
    lfoGain.gain.setValueAtTime(0, start)
    lfoGain.gain.setValueAtTime(0, start + Math.min(VIBRATO_DELAY, body * 0.5))
    lfoGain.gain.linearRampToValueAtTime(freq * VIBRATO_DEPTH, end)
    lfo.connect(lfoGain)
    lfo.start(start)
    lfo.stop(end + 0.02)

    for (const p of PARTIALS) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq * p.ratio
      lfoGain.connect(osc.frequency)

      const g = ctx.createGain()
      g.gain.value = p.gain
      osc.connect(g)
      g.connect(tone)
      osc.start(start)
      osc.stop(end + 0.02)
      this.track(osc, env)
    }

    // 气声：带通白噪跟着音高走，起音比乐音再快一点（先听见气，后出音）
    const breath = ctx.createBufferSource()
    breath.buffer = this.noiseBuffer()
    breath.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = freq * 2
    bp.Q.value = 1.2
    const bg = ctx.createGain()
    bg.gain.setValueAtTime(0.0001, start)
    bg.gain.exponentialRampToValueAtTime(volume * BREATH_GAIN, start + Math.min(0.03, body * 0.3))
    bg.gain.exponentialRampToValueAtTime(0.0001, end)
    breath.connect(bp)
    bp.connect(bg)
    bg.connect(this.master)
    breath.start(start)
    breath.stop(end + 0.02)
    this.track(breath, bg)
  }

  /**
   * 钢琴：起音 4ms，之后一路指数衰减，按不住也停不住。
   * 高音衰减快、低音拖得长（`decayOf`），低通再随时间关下来，音头亮尾巴闷。
   */
  private piano(freq: number, at: number, duration: number, volume: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master || duration <= 0) return

    const start = Math.max(at, ctx.currentTime)
    const decay = decayOf(freq)
    // 音符结束就落下制音器；但短音也得让槌击声出得来
    const end = start + Math.max(0.12, Math.min(duration, decay))
    const stop = end + PIANO_DAMP

    // 指数衰减直接用 exponentialRamp 两点画出来：终值自己算，
    // 不用 setTargetAtTime——那条曲线后面接不上「松键」这一段（读不到未来时刻的值）
    const tau = decay / 6.9 // 衰到千分之一所需时间即 decay
    const held = Math.max(0.0001, volume * Math.exp(-(end - start - PIANO_ATTACK) / tau))

    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, start)
    env.gain.exponentialRampToValueAtTime(volume, start + PIANO_ATTACK)
    env.gain.exponentialRampToValueAtTime(held, end)
    env.gain.exponentialRampToValueAtTime(0.0001, stop)

    // 低通随时间关下来：泛音比基频先死，这是击弦声最好认的特征
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.Q.value = 0.3
    tone.frequency.setValueAtTime(Math.min(11000, freq * 12), start)
    tone.frequency.exponentialRampToValueAtTime(Math.max(freq * 2, 220), stop)
    tone.connect(env)
    env.connect(this.master)

    for (let n = 1; n <= PIANO_PARTIALS; n++) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      // 弦有刚度，泛音略高于整数倍（inharmonicity），差这一点就会像电子琴
      osc.frequency.value = freq * n * Math.sqrt(1 + PIANO_INHARMONICITY * n * n)
      if (osc.frequency.value > ctx.sampleRate / 2) break

      const g = ctx.createGain()
      g.gain.value = 1 / Math.pow(n, 1.6)
      osc.connect(g)
      g.connect(tone)
      osc.start(start)
      osc.stop(stop + 0.02)
      this.track(osc, env)
    }

    // 槌击：一记极短的噪声，给音头一点「木头味」
    const hammer = ctx.createBufferSource()
    hammer.buffer = this.noiseBuffer()
    hammer.loop = true
    const hp = ctx.createBiquadFilter()
    hp.type = 'bandpass'
    hp.frequency.value = Math.min(6000, freq * 5)
    hp.Q.value = 0.8
    const hg = ctx.createGain()
    hg.gain.setValueAtTime(volume * 0.22, start)
    hg.gain.exponentialRampToValueAtTime(0.0001, start + 0.035)
    hammer.connect(hp)
    hp.connect(hg)
    hg.connect(this.master)
    hammer.start(start)
    hammer.stop(start + 0.05)
    this.track(hammer, hg)
  }

  /** 节拍器：重拍高、弱拍低，短促一响 */
  click(at: number, strong: boolean, volume = 0.35): void {
    const ctx = this.ctx
    if (!ctx || !this.master || this.isPast(at)) return
    const start = Math.max(at, ctx.currentTime)
    const end = start + 0.055

    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = strong ? 1600 : 1100

    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(volume * (strong ? 1 : 0.6), start + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, end)

    osc.connect(g)
    g.connect(this.master)
    osc.start(start)
    osc.stop(end + 0.01)
    this.track(osc, g)
  }

  /** 暂停 / 拖进度条：已排期但还没响的全部收掉，且要淡出，硬切会「啪」一声 */
  stopAll(): void {
    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    for (const { source, gain } of this.live) {
      try {
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03)
        source.stop(now + 0.04)
      } catch {
        /* 已经停过的节点会抛，忽略 */
      }
    }
    this.live = []
  }

  close(): void {
    this.stopAll()
    void this.ctx?.close()
    this.ctx = null
    this.master = null
    this.noise = null
  }

  private track(source: AudioScheduledSourceNode, gain: GainNode): void {
    const entry = { source, gain }
    this.live.push(entry)
    source.onended = () => {
      const i = this.live.indexOf(entry)
      if (i >= 0) this.live.splice(i, 1)
    }
  }

  /** 白噪只生成一次，循环复用 */
  private noiseBuffer(): AudioBuffer {
    const ctx = this.ctx!
    if (!this.noise) {
      const len = Math.floor(ctx.sampleRate * 1.5)
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = this.noise.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    }
    return this.noise
  }
}
