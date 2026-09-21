/**
 * 配色的唯一来源。
 *
 * 单独成文件是为了断开循环引用：洞洞谱一列（FingeringColumn）被 ScoreSvg 和
 * 播放窗同时引用，颜色若还留在 ScoreSvg 里，两边就会绕成环。
 */
export const COLORS = {
  ink: '#1a1a1a',
  paper: '#FEFEFC',
  tube: '#F9B556',
  holeOpen: '#FFFFFF',
  holeEdge: '#E0973C',
  watermark: '#E6E6E6',
  warn: '#C98A00',
  /** 播放窗里罩住当前音的方框 */
  cursor: '#E8541F',
}

export const DIGIT_FONT = '"Times New Roman", "Nimbus Roman", "SimSun", serif'
export const TEXT_FONT = '"Noto Serif SC", "Source Han Serif SC", "SimSun", "Microsoft YaHei", serif'
