/**
 * MomoTalk 数据契约（数据轨交付，data/momotalk/）。
 *
 * index.json  = { source, generated, textLang, kind, students: MomoStudentRef[] }
 * <cid>.json  = MomoCharFile
 *
 * 消息 schema（实测全部 15065 条消息的 key 只有
 *   kind / from / text / delayMs / options / story / image —— 无语音字段）：
 *   text   学生或老师的一条气泡
 *   answer 老师回复选项（options[].nextGroup 在数据轨展平时已汇入线性序列）
 *   image  学生发来的照片（ImagePath 如 'UIs/03_Scenario/04_ScenarioImage/Mo_Yuuka_01'）
 *   story  羁绊剧情触发（favorRank / scenarioGroup / path，864 处已验证 0 断链）
 */

/** 会话列表条目（data/momotalk/index.json.students[]） */
export interface MomoStudentRef {
  characterId: number;
  studentId: number;
  devName: string;
  name: string;
  avatar: string;
  messageCount: number;
  threads: number;
  file: string;
}

export interface MomoOption {
  text: string;
  /** 分支组 id（数据已展平为线性，仅作展示参考） */
  nextGroup: number;
}

/** 羁绊剧情触发点 */
export interface MomoStoryRef {
  favorRank: number;
  scenarioGroup: number;
  path: string;
}

export type MomoMessageKind = 'text' | 'image' | 'answer';

export interface MomoMessage {
  kind: MomoMessageKind;
  from: 'student' | 'teacher';
  text?: string;
  /** 学生连续发言的间隔毫秒（打字机节奏） */
  delayMs?: number;
  /** ImagePath，如 'UIs/03_Scenario/04_ScenarioImage/Mo_Yuuka_01' */
  image?: string;
  options?: MomoOption[];
  story?: MomoStoryRef;
}

export interface MomoThread {
  /** 解锁所需好感度等级（AcademyMessanger MessageCondition=FavorRankUp 的 ConditionValue） */
  favorRank: number;
  messages: MomoMessage[];
}

export interface MomoCharFile {
  characterId: number;
  studentId: number;
  devName: string;
  name: string;
  avatar: string;
  messageCount: number;
  threads: MomoThread[];
}

/** MomoTalk 使用的真实 UI 精灵名（data/ui_atlas.json，assetbundle 来源）。
 *  缺精灵时 NineSlice 自动落 css-fallback，不伪造素材。 */
export const MOMO_SPRITES = {
  /** 学生气泡（School 交流族的聊天白模，NGUI 由 mColor 上色） */
  bubble: 'Common/School_Chat_BG',
  /** 老师气泡共用同一白模，CSS 层上蓝色（与引擎行为一致） */
  favor: 'Common/School_Icon_Favor',
  chat: 'Common/School_Icon_Chat',
  momo: 'Common/Common_Icon_MoMoTalk',
  star: 'Icon_Momotalk_Star',
  // 注意：图集里的 Emoji/Emoji_Momotalk 有记录但磁盘缺文件（实测 404），不要引用
  /** 剧情触发卡片底 */
  storyCard: 'Common/Tutorial_Message_BG',
  /** 回复选项按钮底 */
  optionBtn: 'TBG/Common_Btn_BG',
} as const;
