# Joseki Dojo — Go terminology glossary (ru → en / ja / zh-Hans / zh-Hant / ko)

Built from the named start list (88 positions, 17 branches; listed in the appendix). Every move named in the Russian captions was re-derived from the GTP moves
(canonical top-right corner; `Lnn` = line number in the appendix). Coordinates in notes are given as (distance from right edge,
distance from top edge), e.g. Q16 = (4,4), Q17 = (4,3), R17 = (3,3).

Conventions:

- **ja** — written as Japanese players write it (Go terms are customarily in katakana), then kana reading / romaji.
- **zh-Hans / zh-Hant** — mainland and Taiwan/HK forms. Where the traditional form is just the character conversion, it is given without comment.
- **ko** — hangul, with hanja in brackets when the word is Sino-Korean and hanja are commonly shown. Native words (날일자, 붙임, 젖힘…) have no hanja.
- **Confidence**: **High** = the term was found in sources for every language column (or the column is a trivial, sourced character
  conversion); **Medium** = the core term is sourced but one column is composed from sourced parts or only seen in a less
  authoritative source; **Low** = no source found for a key column; the wording given is a proposal and is labelled as such.
- **Sources** are keys; the URL list is at the end. "SL nav SGF" means the letter-to-move mapping was read from the SGF of the
  Sensei's Library navigation diagram, so the SL English name is tied to the exact point, not guessed.

---

## 1. Corner points

| ru | en | ja | zh-Hans | zh-Hant | ko | note | confidence | sources |
|---|---|---|---|---|---|---|---|---|
| звезда, 4-4 (хоси) | star point, 4-4 point (hoshi) | 星（ほし, hoshi） | 星位（xīngwèi） | 星位 | 화점（花點） | ko also 성점（星點）. In ja/zh/ko the same word also means all 9 board dots; for the corner use is unambiguous. | High | SL-JA, SL-CN, SL-KO, JGF:星, jaWP:星, zhWP:星位, koWP:화점, GM:hoshi |
| комоку, 3-4 | 3-4 point (komoku) | 小目（こもく, komoku） | 小目（xiǎomù） | 小目 | 소목（小目） |  | High | SL-CN, SL-JA, SL-KO, JGF:小目, jaWP:小目, zhWP:小目, GM:komoku |
| сан-сан, 3-3 | 3-3 point (san-san) | 三々（さんさん, sansan） | 三三（sānsān） | 三三 | 삼삼（三三） | Japanese writes 三々 (iteration mark), zh/ko 三三. | High | SL-33, SL-CN, SL-KO, JGF:三々, jaWP:三々, GM:sansan |
| такамоку, 5-4 | 5-4 point / 4-5 point (takamoku) | 高目（たかもく, takamoku） | 高目（gāomù） | 高目 | 고목（高目） |  | High | SL-54 (gives zh/ja/ko), JGF:高目, jaWP:高目, zhWP:高目, koWP:고목, GM:takamoku |
| мокухадзуси, 5-3 | 5-3 point / 3-5 point (mokuhazushi) | 目外し / 目ハズシ（もくはずし, mokuhazushi） | 目外（mùwài） | 目外 | 외목（外目） | Character order differs: zh 目外, ko hanja 外目. GoMagic lists zh "外目" — contradicted by SL-CN and zhWP; use 目外. | High | SL-53 (gives zh/ja/ko), SL-CN, zhWP:目外, jaWP:目外し, koWP:외목, GM:mokuhazushi |

## 2. Moves and shapes

### 2a. Approaches and invasions

| ru | en | ja | zh-Hans | zh-Hant | ko | note | confidence | sources |
|---|---|---|---|---|---|---|---|---|
| приближение (общее) | approach (kakari) | カカリ（掛かり, kakari） | 挂角 / 挂（guàjiǎo） | 掛角 / 掛 | 걸침 | Generic word for an approach to a corner stone. | High | SL-CN, SL-KO, JGF:カカリ, jaWP:カカリ, zhWP:挂角, koWP:걸침, GM:kakari |
| малое приближение (4-4: O17; 3-4: R15) | small knight's approach, low approach (keima kakari) | 小ゲイマガカリ（こげいまがかり, kogeima-gakari）; also ケイマガカリ | 小飞挂（xiǎofēi guà）/ 小飞挂角; also 低挂, older 小马步挂 | 小飛掛 / 小飛掛角 | 날일자 걸침 | The pair asked about: zh 小飞挂 vs ja 小ゲイマガカリ vs ko 날일자 걸침 — all verified. | High | SL-JA, SL-CN, SL-44LA, jaWP:カカリ, zhWP:挂角, zhWP:定式 ("星位低挂(小飞挂)"), zhWP:拆 ("小马步挂"), koWP:걸침, namu:화점정석, GM:keima-kakari |
| высокое приближение (4-4: O16; 3-4: Q15; 5-3: Q15) | one-space high approach | 一間高ガカリ（いっけんたかがかり, ikken takagakari）; vs 5-3 simply 高ガカリ | 一间高挂（yījiān gāoguà）/ 高挂 | 一間高掛 / 高掛 | 한칸 높은 걸침（한칸높은걸침） | For the 5-3 point the 4-5 approach is called simply "high approach" (JGF example: 目外しに対し高目へカカる = 高ガカリ). vs the 5-3 point the app writes zh 高挂 / 高掛 (this row's short form) and ko 높은 걸침 — a proposal: no Korean source found for the 5-3 case; 한칸 is dropped as ja drops 一間, since Q15 is not a one-space relation to the 5-3 stone P17. | High (ko 5-3 form Low) | SL-JA, SL-34HA, SL-53, JGF:高ガカリ, jaWP:カカリ, jaWP:小目, zhWP:挂角, zhWP:妖刀定式, BILI, koWP:한칸높은걸침 |
| большое приближение (4-4: N17; 3-4: R14; 3-3: O16) | large knight's approach (ōgeima kakari) | 大ゲイマガカリ（おおげいまがかり, ōgeima-gakari） | 大飞挂（dàfēi guà）/ 大飞挂角 | 大飛掛 / 大飛掛角 | 눈목자 걸침 | Geometry checked in all three groups (knight's move one line further). GoMagic gives ko "큰 깩끼" and zh "大桂馬掛" — not supported by any other source; ignore. SL calls R17→O16 "distant high approach" to the 3-3. | High | SL-JA, jaWP:カカリ, jaWP:小目, zhWP:挂角, BILI ("大飞挂小目"), koWP:걸침, koWP:삼삼날일자받음정석, namu:화점정석 |
| приближение через два пункта (4-4: N16; 3-4: Q14) | two-space high approach (SL: "distant high approach") | 二間高ガカリ（にけんたかがかり, niken takagakari） | 二间高挂（èrjiān gāoguà） | 二間高掛 | 두칸 높은 걸침（두칸높은걸침） | In the 4-4 and 3-4 groups the approaching stone is on the 4th line. The Russian name hides "high" — see section 5. | High | SL-JA, jaWP:カカリ, jaWP:小目, BILI ("二间高挂"), koWP:두칸높은걸침 |
| приближение через два пункта (3-3: O17) | two-space low approach (SL: "distant low approach") | 二間ガカリ（にけんがかり, niken-gakari） | 二间低挂（èrjiān dīguà） | 二間低掛 | 두칸 걸침 | Here the stone is on the 3rd line. JGF: カカリ is used up to two spaces. zh form is composed (二间 + 低挂); not seen verbatim. | Medium | SL-33J, JGF:高ガカリ, koWP:삼삼날일자받음정석 ("두칸…걸쳐왔을 때"), zhWP:定式 (低挂) |
| приближение (к 5-4 и 5-3, в пункт 3-4: R16) | 3-4-point approach ("4-3 approach", SL "low approach") | 小目ガカリ / 小目へのカカリ（こもくがかり, komoku-gakari） | 小目挂（xiǎomù guà） | 小目掛 | 소목 걸침 | zh: zhWP:拆 caption "目外小目挂…" (5-3 + komoku approach). | High | SL-45J, SL-53, jaWP:高目, jaWP:目外し, zhWP:拆, koWP:고목, koWP:날일자씌움 |
| вторжение в 3-3 | 3-3 invasion | 三々入り（さんさんいり, sansan-iri）; on an empty corner early: ダイレクト三々 | 点三三（diǎn sānsān） | 點三三 | 삼삼 침입（侵入） | For 5-4/5-3 also called an "approach" by SL ("3-3 approach") — the Russian "вторжение" is fine. | High | SL-33INV, SL-35J, jaWP:三々, jaWP:ダイレクト三々, zhWP:定式, zhWP:飛刀定式, namu:화점정석, koWP:침입 |

### 2b. Pincers

| ru | en | ja | zh-Hans | zh-Hant | ko | note | confidence | sources |
|---|---|---|---|---|---|---|---|---|
| клешня (низкая / высокая) | pincer (low / high) | ハサミ（挟み, hasami）; high = 高バサミ（たかばさみ） | 夹（jiā）/ 夹攻; low 低夹, high 高夹 | 夾 / 夾攻; 低夾 / 高夾 | 협공（挾攻）; 낮은 협공 / 높은 협공 | Japanese and Korean usually omit "low": 一間バサミ / 한칸협공 already means the low pincer; only the high one is marked (高 / 높은). SL-JA: keima/ōgeima are never used to name pincers. | High | SL-JA, SL-CN, SL-KO, JGF:ハサミ, JGF:高バサミ, jaWP:ハサミ, koWP:낮은협공, koWP:높은협공, GM:hasami |
| низкая клешня в один пункт | one-space low pincer | 一間バサミ（いっけんばさみ, ikken-basami） | 一间低夹（yījiān dījiā） | 一間低夾 | 한칸 협공 / 한칸 낮은 협공 | Checked: one empty point between the approach stone and the pincer, both on the 3rd line. | High | SL-JA, SL-44LA, SL-34LA, KINO, jaWP:ハサミ, zhWP:定式, koWP:바둑 용어 navbox (한칸협공, 화점한칸낮은협공정석) |
| высокая клешня в один пункт | one-space high pincer | 一間高バサミ（いっけんたかばさみ） | 一间高夹（yījiān gāojiā） | 一間高夾 | 한칸 높은 협공 |  | High | SL-JA, JGF:高バサミ, zhWP:定式, BILI, koWP:바둑 용어 navbox (화점한칸높은협공정석) |
| низкая клешня в два пункта | two-space low pincer | 二間バサミ（にけんばさみ） | 二间低夹（èrjiān dījiā） | 二間低夾 | 두칸 협공 / 두칸 낮은 협공 |  | High | SL-JA, SL-44LA, jaWP:ハサミ, koWP:바둑 용어 navbox (두칸협공, 화점두칸낮은협공정석) |
| высокая клешня в два пункта | two-space high pincer | 二間高バサミ（にけんたかばさみ） | 二间高夹（èrjiān gāojiā） | 二間高夾 | 두칸 높은 협공 | vs the 3-4 high approach this pincer is the "Magic sword" (L55). | High | SL-JA, JGF:高バサミ, KINO, zhWP:定式, zhWP:妖刀定式, BILI, koWP:바둑 용어 navbox (두칸높은협공) |
| низкая клешня в три пункта | three-space low pincer | 三間バサミ（さんげんばさみ） | 三间低夹（sānjiān dījiā） | 三間低夾 | 세칸 협공 / 세칸 낮은 협공 |  | High | SL-JA, jaWP:ハサミ, zhWP:大斜定式 ("三间低夹"), koWP:바둑 용어 navbox (세칸협공) |
| высокая клешня в три пункта | three-space high pincer | 三間高バサミ（さんげんたかばさみ） | 三间高夹（sānjiān gāojiā） | 三間高夾 | 세칸 높은 협공 |  | High | SL-JA, JGF:高バサミ, zhWP:定式 |

### 2c. Responses, contact plays and shapes

| ru | en | ja | zh-Hans | zh-Hant | ko | note | confidence | sources |
|---|---|---|---|---|---|---|---|---|
| ответ (на приближение) | response, answer | 受け（うけ, uke）/ 受ける | 应（yìng）/ 应手; as corner defence 守角 | 應 / 應手 / 守角 | 받음 / 응수（應手） | Used in captions "ответ кэймой", "ответ в 3-3". | High | JGF:受ける, CHIKUMA, zhWP:定式 (小飞应, 单关应), 163 (守角), koWP:날일자받음, SL-KO (응수타진) |
| прыжок в один пункт (4-4: Q16→Q14) | one-space jump (SL: "one-space high extension") | 一間トビ（いっけんとび, ikken tobi）; as the answer to an approach: 一間受け（いっけんうけ） | 单关（dānguān）/ 一间跳; as the answer: 单关守角 / 单关应 | 單關 / 一間跳; 單關守角 | 한칸 뜀; as the answer: 한칸 뛰어받음 | L4, L21 (the 3rd-line case of L44 is the next row). | High | SL-JA, SL-CN, SL-44LA (nav SGF), CHIKUMA ("一間受け"), 163 ("单关守角"), zhWP:定式 ("单关应"), koWP:한칸뜀, koWP:화점한칸뛰어받음정석, namu:화점정석 ("한칸 받음") |
| прыжок (вдоль 3-й линии: L44 Q17→O17; L71 R17→P17) | one-space low extension | 一間ビラキ（いっけんびらき, ikken-biraki） | 拆一（chāi yī）/ 一间拆 | 拆一 / 一間拆 | 한칸 벌림 | jaWP:トビ: a move parallel to the edge on the 3rd/4th line made to secure a base is ヒラキ, not トビ. SL names Q17-Q15-O17 "one-space low extension". | Medium | SL-34HA (nav SGF), jaWP:トビ, SL-JA (Ikken biraki), SL-CN (拆一) |
| ответ кэймой | knight's-move answer (SL: "small knight extension") | 小ゲイマ受け / ケイマ受け（こげいまうけ）; vs 3-3 invasion: ケイマ | 小飞（xiǎofēi）; 小飞守角 / 小飞应; vs 3-4 also 侧飞 | 小飛 / 小飛守角 | 날일자 받음（날일자받음） | L5, L28, L33, L43, L61, L70, L72, L88. From the 3-3 point: ko 삼삼날일자받음 (koWP). | High | SL-44LA, SL-34LA, CHIKUMA, KINO ("ケイマ受け"), jaWP:ダイレクト三々 ("ケイマに外す"), 163, zhWP:定式, koWP:날일자받음, koWP:삼삼날일자받음정석, namu:화점정석 |
| ответ большой кэймой | large-knight answer | 大ゲイマ受け（おおげいまうけ） | 大飞守角 / 大飞（dàfēi） | 大飛守角 / 大飛 | 눈목자 받음（눈목자받음） | L6, L22, L23. | High | SL-44LA, JGF:大ゲイマ ("星から大ゲイマ受け"), 163, koWP:눈목자받음 |
| кэйма | knight's move (keima, kogeima) | ケイマ（桂馬, keima）/ 小ゲイマ | 小飞（xiǎofēi）/ 飞 | 小飛 / 飛 | 날일자（日字） |  | High | SL-JA, SL-CN, SL-KO, JGF:ケイマ, jaWP:ケイマ, zhWP:飞, GM:keima-kogeima |
| большая кэйма | large knight's move (ōgeima) | 大ゲイマ（おおげいま, ōgeima） | 大飞（dàfēi） | 大飛 | 눈목자（目字） | GoMagic's ko "대기사" is not supported anywhere else. | High | SL-JA, SL-CN, SL-KO, JGF:大ゲイマ, jaWP:ケイマ, zhWP:飞 |
| кэйма снизу (4-4: P18) | low knight's-move block (SL); knight's move onto the 2nd line under the approach stone | ケイマ (二線へのケイマ) | 二路飞（èrlù fēi） | 二路飛 | 2선 날일자 | SL nav SGF: letter j = (5,2) = "Low Knight's Move Block". zh 二路飞 is attested as a term (BILI titles), ja/ko are descriptive compositions — no name found. | Medium | SL-44LA (nav SGF), BILI |
| косуми | diagonal move (kosumi) | コスミ（尖み, kosumi） | 尖（jiān）/ 小尖 | 尖 / 小尖 | 마늘모 / 입구자（入口字） | jaWP: if an enemy stone is in contact it is no longer "kosumi" (→ コスミツケ). L10 P15 = SL "Takamiya's diagonal"; L63 P16. | High | SL-JA, SL-CN, SL-KO, jaWP:コスミ, zhWP:尖, koWP:마늘모, GM:kosumi |
| косуми в 3-3 / ход в угол | inside diagonal (into the corner / the 3-3 point) | コスミ（隅・三々へのコスミ） | 尖（尖三三） | 尖 | 마늘모 (삼삼으로) | L12 Q16→R17; L56 and L62 Q17→R16 (same idea: diagonal toward the corner). koWP:화점 describes "3·3으로 마늘모 행마". "尖三三" is a composition. The app's ko caption for L12 is 삼삼 마늘모, derived from 마늘모 (삼삼으로) in the noun-phrase order of 삼삼 침입. | Medium | jaWP:星 (fのコスミ), jaWP:小目, koWP:화점, SL-34HA ("inside diagonal") |
| внешняя косуми (3-4, высокое приближение через два пункта: P16) | outside diagonal (counterpart of the inside diagonal R16) | 外へのコスミ (proposal) | 尖出（jiānchū） | 尖出 | 바깥쪽 마늘모 (proposal) | L63 (spec 7.1 renamed «косуми» to «внешняя косуми» to tell it from the inside diagonal R16 of L62). zhWP 定式 labels the same point P16 (Shusaku's move vs the low approach) 尖出, a kosumi toward the centre. en, ja and ko are composed from the «косуми» row and the plain word for "outside"; no name found. | Low (en, ja, ko composed) | zhWP:定式, SL-34HA ("inside diagonal"), row «косуми» |
| косуми-цукэ | diagonal attachment, kosumi-tsuke; vs a low approach: "kick" | コスミツケ（kosumi-tsuke） | 尖顶（jiāndǐng） | 尖頂 | 마늘모붙임 | Same shape in L7 (P17 vs O17, named "прилипание со стороны угла"), L42 (R16) and L83 (White Q15). | High | SL-JA, SL-CN, SL-44LA, SL-34LA, JGF:コスミツケ, jaWP:コスミ, jaWP:小目, CHIKUMA, zhWP:定式 (尖顶 for both 星 and 小目), zhWP:大斜定式, koWP:마늘모붙임 |
| прилипание (общее) | attachment, contact play (tsuke) | ツケ（付け, tsuke） | 碰（pèng）/ 靠（kào）/ 托（tuō）/ 压（yā） — by direction | 碰 / 靠 / 托 / 壓 | 붙임 | Chinese has no neutral joseki word: 托 = from below (edge side), 靠 = one line higher than the enemy stone, 碰 = beside on the same line, 压 = on top of a lower stone. Pick per move (rows below). | High | SL-JA, SL-CN, SL-KO, jaWP:ツケ, zhWP:围棋术语, GM:tsuke |
| прилипание снаружи (4-4: O16 на O17) | attachment on top of the approach stone (leads to tsuke-nobi / tsuke-osae) | ツケ (ツケノビ・ツケオサエの入口) | 压（yā）; with the extension: 压长 | 壓 / 壓長 | 붙임; with the extension: 붙여뻗기 | L8. zhWP 定式 labels exactly this point "压"; the joseki is 压长 (BILI). | High | SL-44LA (nav SGF "attachment"), SL-JA (Tsuke-nobi = 4-4 joseki), JGF:ツケノビ, zhWP:定式, BILI ("压长"), koWP:붙여뻗기, namu:화점정석 |
| прилипание сверху (3-4: Q15 на R15; P15 на Q15) | high / outside attachment (uwa-tsuke) | 上ツケ / 上ヅケ（うわつけ, uwa-tsuke）= 外ヅケ | 靠（kào）/ 外靠 | 靠 / 外靠 | 위붙임 | L41, L52. JGF: 上ヅケ = attachment toward the centre, same as 外ヅケ. SL: "3-4 low approach high attachment", "3-4 high approach outside attachment". | High | SL-34LA, SL-34HA (nav SGF), SL-JA, JGF:上ヅケ, JGF:外ヅケ, KINO ("一間高ガカリ 上ツケ"), jaWP:小目, zhWP:定式 (小目高挂: 靠), BILI ("外靠"), koWP:위붙임 |
| прилипание снизу (3-4: R15 под Q15) | inside attachment / attachment underneath (shita-tsuke) | 下ツケ / 下ヅケ（したつけ, shita-tsuke）= 内ヅケ | 托（tuō） | 托 | 밑붙임 | L45. Start of both ツケヒキ and ナダレ. | High | SL-34HA (nav SGF "inside attachment"), SL-AV, JGF:外ヅケ (内ヅケ = 下ヅケ), jaWP:ナダレ定石, jaWP:ツケヒキ定石, zhWP:定式 (小目高挂: 托), zhWP:小目 ("托退"), koWP:밑붙임, koWP:눈사태 정석 |
| прилипание снаружи / изнутри (5-4: R15 / R17 к камню R16) | outside / inside attachment | 外ツケ（そとづけ）/ 内ツケ（うちづけ） | 外靠 / 托 | 外靠 / 托 | 위붙임 / 밑붙임 | L74, L75. ja verified for takamoku (jaWP:高目 "内側からツケ"). zh/ko derived from the JGF equivalence 外ヅケ = 上ヅケ, 内ヅケ = 下ヅケ and the sourced zh/ko words for those; not seen verbatim for takamoku. | Medium | SL-45J ("inside/outside contact"), SL-JA, JGF:外ヅケ, JGF:内ヅケ, jaWP:高目, zhWP:定式, koWP:위붙임, koWP:밑붙임 |
| прилипание (к камню 3-3: R16 на R17) | attachment (on the invading 3-3 stone) | ツケ | 靠（kào） | 靠 | 붙임 (위붙임) | L79, L91 (same move, two different captions). | Medium | SL-45J ("If [Black] attaches…"), SL-35J, SL-CN (靠) |
| прилипание к голове (3-4 два пункта: P14 к Q14) | attachment on the head (centre side) of the approaching stone | 頭ツケ（あたまつけ, atama-tsuke）/ 上ツケ | 靠（kào） | 靠 | 위붙임 | L65. Do not use 鼻ヅケ / 코붙임: both mean attaching in front of two or more stones in a row. | Medium | SL-JA ("Atama-tsuke: attach at the higher side"), JGF:上ヅケ, JGF:鼻ヅケ, koWP:코붙임, SL-CN (靠) |
| прилипание под кэйму (3-3: S14 под R14) | attachment underneath the knight's move (2nd-line attachment) | 下ツケ（したつけ） | 托 / 二路托（èrlù tuō） | 托 / 二路托 | 밑붙임 (2선) | L29. Entry move of the flying knife. ja and zh verbatim; ko is the general word for the same contact (no verbatim source). | Medium | jaWP:ダイレクト三々 ("白4と下ツケ"), zhWP:飛刀定式 ("二路托"), SL-FK ("Small Knight, Attach"), koWP:밑붙임 |
| шапка | cap (bōshi) | ボウシ（帽子, bōshi） | 镇（zhèn）/ 镇头 | 鎮 / 鎮頭 | 모자（帽子）/ 모자씌움 | L9 O15 is SL "knight's move cap" (also a knight's move from Q16). JGF: covering from above at one-space distance — matches O15 vs O17. | High | SL-JA, SL-CN, SL-KO, SL-44LA (nav SGF), JGF:ボウシ, jaWP:ボウシ, zhWP:围棋术语, GM:boshi |
| удар в плечо | shoulder hit (katatsuki) | 肩ツキ / カタツキ（かたつき, katatsuki） | 肩冲（jiānchōng）; also written 尖冲 | 肩衝 / 尖衝 | 어깨짚기 / 어깨짚음 | L57, L67, branch L108. Japanese: the same diagonal contact from the low side is カド, not 肩ツキ. | High | SL-JA, SL-CN (尖冲), JGF:肩ツキ, jaWP:カタツキ, BILI (肩冲), koWP:어깨짚기, koWP:삼삼어깨밀기정석, GM:katatsuki |
| кадо (кэйма под камень, before spec 7.1 «ход под камень»: 3-4 два пункта, R15) | kado — the low diagonal point of the approach stone (a knight's move from the 3-4 stone) | カド（kado） | 小飞守角 (composed) | 小飛守角 (composed) | 밑 날일자 (proposal) | L64. jaWP:小目: against 二間高ガカリ "黒はaとカドに打って隅の地を確保". No zh/ko term found. zh: R15 is the small knight's enclosure point of the 3-4 stone Q17, so the move makes the 小飞守角 shape (term from the «ответ кэймой» row); plain 小飞 would also name the sibling L61 (O16). ko: 밑 ("under", as in 밑붙임) + 날일자, after the Russian «кэйма под камень»; plain 날일자 would read like the sibling L61 날일자 받음. | Medium (zh composed, ko Low) | jaWP:小目, JGF:カド, jaWP:カタツキ |
| хане | hane | ハネ（跳ね, hane） | 扳（bān） | 扳 | 젖힘 |  | High | SL-JA, SL-CN, SL-KO, jaWP:ハネ, koWP:젖힘, GM:hane |
| хане по второй линии | hane on the second line | 二線のハネ（にせんのハネ） | 二路扳（èrlù bān） | 二路扳 | 2선 젖힘 | L26 (White S15). Composed from sourced parts ("二路" as in 二路托/二路飞, "2선"); no verbatim joseki name. | Medium | SL-33INV, zhWP:飛刀定式 (二路…), jaWP:ハネ |
| двойное хане | two-step hane, "double hane" (SL) | 二段バネ（にだんばね, nidan-bane） | 连扳（liánbān） | 連扳 | 이단젖힘（二段-） | L27 (Black S14 after R15). SL-JA warns: 両バネ (ryō-bane) is a different thing (hane on both sides) — do not use it. | High | SL-JA, SL-CN, SL-33INV ("Double Hane"), jaWP:ハネ, jaWP:ダイレクト三々 ("二段バネ"), koWP:이단젖힘, GM:nidanbane |
| блок | block (osae) | オサエ（押さえ, osae） | 挡（dǎng） | 擋 | 막음 / 막기 | L24. | High | SL-CN, JGF:オサエ, jaWP:オサエ, zhWP:围棋术语, koWP:막음, GM:osae |
| отход | draw back (hiki) | 引き / ヒキ（hiki） | 退（tuì） | 退 | 끌기 / 물러섬 | L47. JGF: same shape as ノビ, but toward one's own stones. | High | SL-JA, SL-CN, JGF:ヒキ, koWP:끌기, GM:hiki |
| раскрытие | extension (hiraki) | ヒラキ（開き, hiraki） | 拆（chāi）/ 开拆 | 拆 / 開拆 | 벌림 | L73 (R17→R14 = two-space). | High | SL-JA, SL-CN, SL-KO, jaWP:ヒラキ, zhWP:拆, koWP:벌림, GM:hiraki |
| раскрытие на два пункта | two-space extension | 二間ビラキ（にけんびらき） | 拆二（chāi èr）/ 二间拆 | 拆二 / 二間拆 | 두칸 벌림（두칸벌림） | L34 (Q17→N17, SL "two-space extension"), L69, L73. | High | SL-JA, SL-CN, SL-34LA (nav SGF), jaWP:ヒラキ, jaWP:小目, koWP:두칸벌림 |
| высокое раскрытие (3-3: Q14) | large-knight extension (one line higher than the two-space extension) | 大ゲイマ（大ゲイマビラキ / 大ゲイマ受け） | 大飞 | 大飛 | 눈목자 받음 | L68: Q14 is a large knight's move from R17. SL 3-3: developments "keima … or ogeima … on the fourth line". Korean joseki name 삼삼눈목자받음정석 exists. | Medium | SL-33, JGF:大ゲイマ, koWP:바둑 용어 navbox |
| ответ вдоль края (3-3 после удара в плечо: Q17) | crawl / push along the 3rd line | ハイ（這い, hai） | 爬（pá）/ 长（cháng） | 爬 / 長 | 밀기 (삼삼 어깨 밀기) | L67. JGF: ハイ = moving along the 2nd/3rd line under the opponent. zhWP limits 爬 to the 1st–2nd line, so 长 is also natural; the Korean joseki is literally "3-3 shoulder-hit push joseki". | Medium | JGF:ハイ, jaWP:ハイ, jaWP:オシ, SL-CN, zhWP:围棋术语, koWP:삼삼어깨밀기정석 |
| ответ в 3-3 (5-3: R17) | 3-3 answer | 三々（三々に受ける） | 三三 | 三三 | 삼삼 (받음) | L89. SL: "3-3 answer". The app's ja caption is 三々受け, derived: 三々 + 受け (row «ответ (на приближение)»), like 一間受け / 小ゲイマ受け. | Medium | SL-35J, jaWP:目外し |
| прижимание кэймой | knight's-move press (keima-gake) | ケイマガケ（けいまがけ, keima-gake）/ カケ | 飞压（fēiyā） | 飛壓 | 날일자씌움 | L76 (5-4: Q14), L80 (5-3: Q15), L90 (5-3 vs 3-3: Q15). koWP defines 날일자씌움 exactly for komoku approaches to takamoku/mokuhazushi; 외목날일자씌움정석 also covers the 3-3 approach. | High | SL-JA (Keimagake), JGF:カケ, jaWP:高目, jaWP:大斜定石, SL-CN (飞压), zhWP:大斜定式 ("A位飞压"), koWP:날일자씌움, koWP:외목날일자씌움정석 |
| прижимание большой кэймой | large-knight press (ōgeima-gake; vs 5-4: takamoku taisha-gake) | 大ゲイマガケ / 大斜ガケ（高目大斜ガケ） | 大斜 / 大飞压 | 大斜 / 大飛壓 | 눈목자씌움 | L77 (5-4: Q13). JGF has the term 高目大斜ガケ. zh 大飞压 is composed; 大斜 is sourced. | Medium | SL-JA (Oogeima-gake), SL-TA ("takamoku taishagake"), JGF:高目大斜ガケ, zhWP:大斜定式 ("大斜飞"), koWP:눈목자씌움 |
| прыжок с прилипанием (тайся: P16) | jump-attachment (tobitsuke) | トビツケ（tobitsuke） | 跳贴 (proposal) | 跳貼 (proposal) | 뛰어붙임 | L82. ja verified (main taisha line). ko 뛰어붙임 attested as a term (화점뛰어붙임정석). No zh term found — zhWP only marks the point as "C". | Medium (zh Low) | JGF:トビツケ, jaWP:大斜定石, jaWP:トビ, koWP:화점정석, koWP:바둑 용어 navbox |
| прыжок (общее) | jump (tobi) | トビ（跳び, tobi） | 跳（tiào）/ 关 | 跳 / 關 | 뜀 | L21. | High | SL-JA, SL-CN, jaWP:トビ, GM:tobi |

## 3. Named joseki

| ru | en | ja | zh-Hans | zh-Hant | ko | note | confidence | sources |
|---|---|---|---|---|---|---|---|---|
| лавина | avalanche joseki (nadare) | ナダレ / ナダレ定石（なだれじょうせき, nadare jōseki）; kanji 雪崩 | 雪崩（xuěbēng）/ 雪崩定式 | 雪崩 / 雪崩定式 | 눈사태 / 눈사태 정석; also 붕설형 정석（崩雪形定石） | Arises from 3-4 high approach + inside attachment (下ツケ) when White extends at the 4-4 point and then hanes (L48–L51). Japanese Go writing uses katakana ナダレ. | High | SL-AV (gives zh/ja/ko), jaWP:ナダレ定石, JGF:ナダレ型, zhWP:雪崩定式, koWP:눈사태 정석, enWP:Nadare, GM:nadare |
| начало лавины (W Q16) | avalanche: White extends instead of the hane | ノビ (ナダレ型へ) | 长 (走向雪崩) | 長 | 뻗음 | L48. SL-34HA: White answers the attachment with a hane (common) or "extend at b, potentially leading to an avalanche". | Medium | SL-34HA, SL-AV, GM:nobi |
| лавина — выбор между малой и большой (W P17) | avalanche base position (small or large?) | ナダレの基本形 | 雪崩（基本型） | 雪崩（基本型） | 눈사태 (기본형) | L49. jaWP: from this shape Black's c → 小ナダレ, d → 大ナダレ. | High | jaWP:ナダレ定石, SL-AV, enWP:Nadare |
| малая лавина | small avalanche (konadare) | 小ナダレ（こなだれ, konadare） | 小雪崩 | 小雪崩 | 작은 눈사태 / 소붕설형（小崩雪形） | L50: Black's hane at Q14 — JGF: 二子の頭をタタく. | High | SL-JA, SL-AV, JGF:小ナダレ, zhWP:雪崩定式 (黑7扳), SL-KO, koWP:눈사태 정석 |
| большая лавина | large avalanche (ōnadare) | 大ナダレ（おおなだれ, ōnadare） | 大雪崩 | 大雪崩 | 큰 눈사태 / 대붕설형（大崩雪形） | L51: Black extends R14 first; the large avalanche shape proper forms after Black's following hane (see section 5). | High | SL-JA, SL-CN, SL-AV, JGF:ナダレ型, jaWP:ナダレ定石, zhWP:雪崩定式, SL-KO, koWP:눈사태 정석 |
| хане и отход (прилипание снизу — хане — отход) | attach-and-draw-back joseki (tsuke-hiki) | ツケヒキ定石（つけひきじょうせき） | 托退（tuō tuì）/ 托退定式 | 托退 | 붙여끌기 정석 | L46–L47. Note: Japanese calls White's R14 here オサエ, Chinese/Korean call it a hane (扳 / 젖힘). | High | SL-JA (Tsuke-hiki: 3-4 joseki), jaWP:ツケヒキ定石, JGF:ツケ引き, zhWP:小目 ("托退"), BILI, koWP:붙여끌기 |
| тайся | taisha ("large slant") | 大斜（たいしゃ, taisha）/ 大斜定石; the move: 大斜ガケ | 大斜（dàxié）/ 大斜定式; saying 大斜千变 | 大斜 / 大斜定式 | 대사（大斜）/ 대사정석; also 대사백변 | L81: 5-3, komoku approach, large-knight press Q14. ja proverb 大斜百変 / 千変. | High | SL-TA, SL-35J, JGF:大斜, jaWP:大斜定石, zhWP:大斜定式, koWP:대사정석, koWP:눈목자씌움, SL-KO, enWP:Taisha, GM:taisha |
| тайся — прилипание (W P16) | taisha, jump-attachment (main line) | 大斜 トビツケ | 大斜 (跳贴, proposal) | 大斜 (跳貼, proposal) | 대사 뛰어붙임 | L82. See the トビツケ row. | Medium (zh Low) | jaWP:大斜定石, JGF:トビツケ |
| тайся — простой ответ (W Q15) | taisha, kosumi-tsuke (diagonal attachment) | 大斜 コスミツケ | 大斜 尖顶 | 大斜 尖頂 | 대사 마늘모붙임 | L83. zhWP 大斜定式 calls exactly this move 尖顶 (AlphaGo line B). See section 5 about the word "simple". | High | jaWP:大斜定石, zhWP:大斜定式, koWP:마늘모붙임 |
| волшебный меч Мурамасы / меч Мурамасы | Muramasa's magic sword (magic sword joseki) | 村正の妖刀（むらまさのようとう, Muramasa no yōtō）; also 妖刀定石 | 妖刀（yāodāo）/ 妖刀定式 | 妖刀 / 妖刀定式 | 요도（妖刀）/ 요도정석 | L55: 3-4 one-space high approach + two-space high pincer — matches jaWP/SL definition exactly. "무라마사의 요도" not found; Korean uses 요도정석. | High | SL-MS (zh/ja), jaWP:村正の妖刀, zhWP:妖刀定式, koWP:요도정석 |
| летящий нож | flying knife / flying dagger joseki | no established name; Chinese loan 飛刀（ひとう）/ 飛刀定石 seen in blogs; Japanese sources describe it as ケイマ → 下ツケ → オサエ → 出切り | 飞刀（fēidāo）/ 飞刀定式; the big branch: 芈氏飞刀（"Mi's flying knife"） | 飛刀 / 飛刀定式 / 羋氏飛刀 | no established name; proposal 비도（飛刀）정석 | L30 matches SL exactly (4-4 3-3 invasion, small knight, attach; hane, inside cut) and zhWP (小飞后托扳, 断). English Wikipedia uses "flying knife joseki". | Medium (ja Low, ko Low) | SL-FK, zhWP:飛刀定式, enWP:Joseki, jaWP:ダイレクト三々, JA-BLOG-FK, SL-CN (飞刀) |
| косуми Сюсаку | Shusaku's kosumi (Shusaku's diagonal) | 秀策のコスミ（しゅうさくのこすみ, Shūsaku no kosumi） | 秀策尖 / 秀策的尖（xiùcè jiān）; zhWP 定式 labels the move 尖出 | 秀策尖 / 秀策的尖 | 슈사쿠의 마늘모 | L32: 3-4, low approach R15, kosumi P16 — the canonical move. | High | JGF:秀策流, jaWP:コスミ, jaWP:小目, zhWP:尖, zhWP:本因坊秀策, zhWP:定式, koWP:혼인보 슈사쿠, SL-34LA |

## 4. App UI terms

| ru | en | ja | zh-Hans | zh-Hant | ko | note | confidence | sources |
|---|---|---|---|---|---|---|---|---|
| джосэки (дзёсэки) | joseki | 定石（じょうせき, jōseki） | 定式（dìngshì） | 定式 (also 定石) | 정석（定石） | zh writes 定式, ja/ko 定石. | High | SL-CN, SL-KO, JGF:定石, GM:joseki, zhWP:定式 |
| тэнуки | tenuki (play elsewhere) | 手抜き（てぬき, tenuki） | 脱先（tuōxiān） | 脫先 | 손뺌 / 손빼기 |  | High | SL-JA, SL-CN, SL-KO, JGF:手抜き, jaWP:手抜き, GM:tenuki |
| ловушка (хамэтэ) | trick play, trap (hamete) | ハメ手（はめて, hamete） | 骗招 / 骗着（piànzhāo）; generic "trap" 陷阱 | 騙招 / 騙著; 陷阱 | 함정수（陷穽手）/ 속임수 | koWP distinguishes 함정수 (a joseki trap that stays within sound moves) from 속임수 (an unsound trick); for hamete in a joseki trainer 함정수 is the safer word. | High | SL-CN, SL-KO, JGF:ハメ手, jaWP:ハメ手, zhWP:飛刀定式 ("骗招"), DIQT, koWP:함정수, namu:화점정석, GM:hamete |
| правильный ответ на ловушку | correct answer / refutation | 正しい対応 / 正しい受け; to punish: 咎める（とがめる） | 正解 / 破解（破解骗招） | 正解 / 破解 | 정수（正手）/ 정답（正答）; method: 파훼법 | jaWP:ハメ手 "正しい対応"; KaTrain ja "とがめる手順" for refutation; namu "유일한 정수"; SL-KO 정답/정해 = correct answer; SL-CN 破解 = solution. | Medium | jaWP:ハメ手, KT, SL-CN, SL-KO, namu:화점정석 |
| попался (в ловушку) | fell for the trap ("caught") | ハマった / 引っかかった（ハマる, 引っかかる） | 中招了 / 上当了 | 中招了 / 上當了 | 걸려들었다 / 당했다 | ja: jaWP:ナダレ定石 "プロでもハマる", jaWP:ハメ手 "引っかかって"; ko: namu "함정수를…당하고 만다". zh is common usage, no source found. | Medium (zh Low) | jaWP:ナダレ定石, jaWP:ハメ手, namu:화점정석 |
| сомнительный ход соперника | dubious / questionable move (off the book, slightly worse) | 疑問手（ぎもんしゅ, gimonshu）; milder: 緩手（かんしゅ） | 疑问手（yíwènshǒu） | 疑問手 | 의문수（疑問手） | Chinese AI reviews grade 疑问手 < 不妥手 < 恶手. ja 疑問手 is common commentary usage but was not found in a glossary (JGF has 悪手, 緩手); ko 의문수 not found in a source. | Medium (ko Low) | SL-CN, JGF:緩手, JGF:悪手 |
| чёрные / белые | Black / White (stones, player colours) | 黒（くろ）/ 白（しろ）; players 黒番 / 白番 | 黑 / 白; players 黑方 / 白方; stones 黑棋 / 白棋 | 黑 / 白; 黑方 / 白方 | 흑（黑）/ 백（白）; 흑돌 / 백돌 |  | High | SL-CN, SL-KO, KT, GM:kuro, GM:shiro |
| кю ("7 кю") | kyu ("7 kyu", short 7k) | 7級（ななきゅう）— written 7級; Latin "7k" only on international servers | 7级 | 7級 | 7급（級） | Short forms: en 7k; ja 7級; zh 7级; zh-Hant 7級; ko 7급. | High | SL-CN, SL-JA, SL-KO, KT (k → 級/级/級/급), GM:kyu |
| дан ("1 дан") | dan ("1 dan", short 1d) | 初段（しょだん）for 1 dan; 2段, 3段… | 1段 (also 初段) | 1段 (also 初段) | 1단 (also 초단（初段）) | jaWP 段級位制: "一段" is not used — write 初段. Chinese/Korean amateur ranks start at 1段/1단 (zhWP), pros at 初段. Short forms: en 1d; ja 初段; zh 1段; ko 1단. | High | jaWP:段級位制, zhWP:段级位制, SL-CN, SL-JA, KT (d → 段/段/段/단), GM:dan, GM:shodan |
| очки (счёт) | points (score) | 目（もく, moku）; difference 目差 | 目（mù）; difference 目差 | 目 / 目差 | 집; difference 집 차이 | Under Chinese area scoring the counting unit is 子, but AI score displays use 目 (KaTrain, Lizzie). | High | JGF:目数, SL-CN, KT, LZ, GM:moku |
| «чёрные ведут на N очков» | Black leads by N points (B+N) | 黒がN目リード / 黒N目優勢 | 黑领先N目 | 黑領先N目 | 흑 N집 우세 | Half points: 18目半 / 18目半 / 18집반. | Medium | KT (ja "黒の何目リード"), ITH ("盘面领先18目半"), LZ ("盘面领先"), KD ("백 2집반 우세") |
| посещения (визиты MCTS) | visits (playouts) | 探索手数（たんさくてすう）/ プレイアウト数 | 计算量 / 模拟量 / 计算深度 | 走訪數 / 計算深度 | 탐색 수 (KaTrain keeps "visit") | No standard term in any CJK language; GUIs differ. | Medium | KT, LZ |
| угол | corner | 隅（すみ, sumi） | 角（jiǎo） | 角 | 귀 |  | High | SL-JA, SL-CN, GM:sumi, koWP:화점 ("귀의 화점") |
| разбор партии | review, game analysis | 検討（けんとう, kentō）; players' post-game talk: 感想戦（かんそうせん） | 复盘（fùpán） | 復盤 | 복기（復棋） |  | High | SL-CN, zhWP:复盘, DAUM (복기 vs 復盤 vs 検討) |
| вариант | variation | 変化（へんか, henka）/ 変化図 | 变化（biànhuà）/ 变化图; branch 分支 | 變化 / 變化圖 | 변화 / 변화도 |  | High | SL-CN, SL-KO, LZ, KT |
| карта территории (владение) | territory / ownership map | 地合推定 (KaTrain); positional judgement 形勢判断 | 形势判断; ownership 领地显示 | 形勢判斷; 領地顯示 | 집 모양 (KaTrain); positional judgement 형세판단（形勢判斷） | "Ownership" has no settled word; the GUIs show it under "positional judgement". | Medium | KT, LZ, JGF:形勢判断, koWP:형세판단 |
| пас | pass | パス（pasu） | 虚手（xūshǒu）/ UI: 停一手 | 虛手 | 패스 / 착수 넘김 / 한수쉼 | Korean GUIs differ (KaTrain 착수 넘김, Lizzie 한수쉼). | High | SL-JA, SL-CN, zhWP:围棋术语, KT, LZ |
| фусеки | fuseki, opening | 布石（ふせき, fuseki） | 布局（bùjú） | 布局 | 포석（布石） | Start screen environment chip «фусеки». SL-CN gives the traditional form 佈局, but zhWP (zh-tw) titles the article 布局 (圍棋): Taiwan writes 布局. | High | SL-JA, SL-CN, SL-KO, zhWP:布局_(围棋), koWP:바둑_용어_목록 |
| лесенка | ladder (shicho) | シチョウ（shichō） | 征子（zhēngzǐ）/ 征 | 征子 / 征 | 축（逐） | Start screen environment chip «лесенка». SL-CN also lists the colloquial 扭羊头. | High | SL-JA, SL-CN, SL-KO, jaWP:囲碁用語一覧, zhWP:围棋术语 (征：「征子」), koWP:바둑_용어_목록 |
| пустой угол | empty corner | 空き隅（あきすみ, akisumi） | 空角 | 空角 | 빈 귀 | Root of the «Из списка» tree. zh and ko are composed from the «угол» row (角 / 귀) and the plain word for "empty"; no glossary entry found for them. | Medium (zh, ko composed) | SL-JA, row «угол» |
| ход (один ход партии; чей ход) | move; whose move: turn to play | 手（て, te）/ 着手（ちゃくしゅ）; numbered: N手目; turn: 手番（てばん） | 手（shǒu）; numbered: 第N手; to play a stone: 落子 | 手; 第N手; 落子 | 수（手）/ 착수（着手）; numbered: N수; turn: 차례 | KaTrain "Move {number}": 手数{number} / 手数 {number} / 手數 {number} / {number}수; Lizzie "Last move": 最終手 / 最后一手 / 마지막 수. Japanese prose numbers moves N手目. | High | SL-JA (Chakushu, Teban), SL-CN (手), SL-KO (Chaksu), KT, LZ |
| ходы (список ходов на экране игры) | moves (the move list) | 手順（てじゅん, tejun） | 手顺（shǒushùn） | 手順 | 수순（手順） | `game.moves` aria-label; not 棋譜 (the record of a whole game, kifu). ja 手順 is glossed "a series of moves" and zh 手顺 (手順) "sequence"; ko 수순 is the word KaTrain ko uses for a sequence of moves (Sensei's Library has no Korean entry for it). | Medium | SL-JA (Tejun: a series of moves), SL-CN (手顺 (手順): sequence), KT (ko: 수순 for a move sequence; ja: 予想手順) |
| ответ на ход (общее) | reply, answer to a move | 応手（おうしゅ, ōshu） | 应手（yìngshǒu） | 應手 | 응수（應手） | Any reply, e.g. «ваш ответ на ошибку бота». The «ответ (на приближение)» row above is the answer to an approach (受け). | High | SL-JA (Oushu: reply move), SL-CN (试应手), SL-KO (응수타진/應手打診) |
| партия | game (one game of Go) | 対局（たいきょく, taikyoku） | 对局（duìjú） | 對局 | 대국（對局） |  | High | SL-JA (Taikyoku), SL-CN (对局), SL-KO (Daeguk), KT (game:normal: 通常対局 / 分先对局 / 分先對局 / 일반 대국), LZ |
| позиция | position (the stones on the board) | 局面（きょくめん, kyokumen） | 局面（júmiàn） | 局面 | 국면（局面） |  | High | SL-JA (Kyokumen), zhWP:围棋术语 (劫: 局面), KT (SGF Notes Hint: 此局面 / 이 국면) |
| доска | board | 碁盤（ごばん, goban）; on the board: 盤上 | 棋盘（qípán）; on the board: 盘上 | 棋盤; 盤上 | 바둑판; short: 판 |  | High | SL-JA (Goban, Ban), SL-CN (棋盘), SL-KO (Baduk Pan), KT (board size: 碁盤サイズ / 棋盘大小 / 棋盤大小 / 판 크기), LZ |
| точно (оценка хода) | accurate (the move lost less than the inaccuracy threshold) | 正確（せいかく） | 准确 | 準確 | 정확 | A plain word, not a Go term; KaTrain names its accuracy rating with it (正確度 / 准确度 / 準確度 / 정확도). | High | KT (stat:accuracy) |
| неточность (оценка хода) | inaccuracy (a small loss) | 疑問手（ぎもんしゅ, gimonshu） | 疑问手（yíwènshǒu） | 疑問手 | 의문수（疑問手） | The same word as «сомнительный ход соперника»: both are slightly worse moves. ko alternative: 완착（緩着）, "a slack move, not a bad move" (koWP:완착). | Medium (ko Low) | SL-JA (Gimonshu), SL-CN (疑问手), row «сомнительный ход соперника», koWP:완착 |
| ошибка (оценка хода) | mistake (bad move) | 悪手（あくしゅ, akushu） | 恶手（èshǒu） | 惡手 | 악수（惡手） | SL-JA glosses 悪手 "mistake"; zhWP: 恶手 "损失明显"; koWP:악수 "bad move". Chinese AI reviews mark such moves 恶手. The everyday words (ミス, 失误 / 失誤, 실수) stay for mistakes in general («Ошибки бота»). | High | SL-JA (Akushu), SL-CN (恶手), zhWP:围棋术语 (俗手), koWP:악수 |
| грубая ошибка (оценка хода) | blunder (a big loss) | 大悪手（だいあくしゅ） | 大恶手 | 大惡手 | 대악수（大惡手） | Composed: 大 + the «ошибка» word, the usual way to grade a worse bad move (疑問手 < 悪手 < 大悪手). 敗着 / 败着 / 패착 mean "the move that lost the game", too strong for a per-move grade. | Medium (composed) | row «ошибка», SL-JA (Haichaku), SL-CN (败着), koWP:패착 |
| лучший ход | best move | 最善手（さいぜんしゅ）; short: 最善 | 最佳选点; short: 最佳 | 最佳選點; 最佳 | 최선의 수 / 최선수; short: 최선 |  | High | KT (Info:best move, stat:aitopmove), LZ (最善手), jaWP:囲碁用語一覧 (青い: 最善手) |
| ходы-кандидаты | candidate moves (the engine's top moves) | 候補手（こうほしゅ）; the list: 上位候補 | 选点; the list: 最佳选点 | 選點; 最佳選點 | 후보수（候補手） |  | High | KT (analysis:topmoves, analysis:equalize) |
| ветка (продолжение хода-кандидата) | branch (the engine's line after a candidate, its principal variation) | 変化図（へんかず） | 变化图（biànhuà tú） | 變化圖 | 변화도（變化圖） | Lizzie's "variation display" — the line it shows for a candidate — is 変化図 / 变化图 / 변화도. The player's own variation keeps 変化 / 变化 / 變化 / 변화 (row «вариант»), so the two stay apart. | Medium | LZ (keyV: toggle variation display), row «вариант» |
| наказать ошибку | punish (a mistake) | 咎める（とがめる, togameru） | 惩罚（chéngfá） | 懲罰 | 응징（膺懲） | KaTrain's "refutation" is とがめる手順 / 反击 / 反制手段 / 대응책. zh and ko are the usual commentary words; no glossary entry found for them. | Medium (zh, ko Low) | KT (teaching undo message), row «правильный ответ на ловушку» |
| движок (KataGo) | engine | エンジン | 引擎（yǐnqíng） | 引擎 | 엔진 | Not a Go term, but every Go GUI names the AI program so: KaTrain "engine settings" エンジン設定 / KataGo引擎设置 / 엔진 설정, Lizzie "Engine" エンジン / 引擎 / 엔진. zh-Hant has the same characters (KaTrain tw writes just "KataGo設定"). | High | KT (engine settings), LZ (LizzieConfig.title.engine) |
| сеть (нейросеть KataGo, файл весов) | network, net (the neural net file) | ネットワーク | 网络 | 網路 | 네트워크 | No settled word: KaTrain says "model" (KataGoモデルファイル / KataGo模型文件 / KataGo模型檔 / KataGo 신경망 파일), Lizzie "weights" (权重文件; ja "weight file", ko "Network 파일"). The app keeps the KataGo word "network" (ネットワーク / 网络 / 網路 / 네트워크) in every text: the main net, the human net, the settings and the install list. | Medium | KT (engine:model, engine:humanlike_model, models available), LZ (prompt.selectWeight, display.network-missing) |
| Ваш уровень (настройка) | Your level | あなたのレベル | 你的水平 | 你的程度 | 내 수준 | The setting `settings.level.title`: the player's rank on the bot's scale (rows «кю», «дан») plus «профи». The rank words themselves follow those rows. | App word (catalogs), not a Go term | catalogs |
| профи (уровень) | pro | プロ | 职业 | 職業 | 프로 | `level.pro`, the step above 9 дан on «Ваш уровень». | App word (catalogs), not a Go term | catalogs |
| повторение (вкладка «Повторение», повторение карточки) | repetition (tab: Repetition) | 復習（ふくしゅう） | 复习 | 複習 | 반복 | The tab, the queue and one repetition of a card (`header.repetition`, `repetition.title`; the review panel `review.repetition.title`: Position repetition / 局面の復習 / 局面复习 / 局面複習 / 국면 반복). Not the game review, which is 検討 / 复盘 / 復盤 / 복기 (row «разбор партии»). | App word (catalogs), not a Go term | catalogs |
| Снова (оценка повторения) | Again | もう一度 | 重来 | 重來 | 다시 | `rating.again`, the first of the four FSRS ratings; the app's own rating for a mistake, a blunder or an unpunished mistake. | App word (catalogs), not a Go term | catalogs |
| Трудно (оценка повторения) | Hard | 難しい | 困难 | 困難 | 어려움 | `rating.hard`; the app's own rating for an inaccuracy. | App word (catalogs), not a Go term | catalogs |
| Хорошо (оценка повторения) | Good | 正解 | 良好 | 良好 | 알맞음 | `rating.good`; the app's own rating when every move was accurate. | App word (catalogs), not a Go term | catalogs |
| Легко (оценка повторения) | Easy | 簡単 | 简单 | 簡單 | 쉬움 | `rating.easy`; only the player gives it. | App word (catalogs), not a Go term | catalogs |
| изучается (карточка на этапе обучения) | learning | 学習中 | 学习中 | 學習中 | 학습 중 | `repetition.stage.learning`, `tree.card.learning`: a card in its learning or relearning steps. | App word (catalogs), not a Go term | catalogs |
| изучена (карточка на этапе повторения) | learned | 習得済み | 已掌握 | 已掌握 | 학습 완료 | `repetition.stage.learned`, `tree.card.learned`; the tree's «изучено N из M» uses the same word (`tree.progress`: 習得 / 已掌握 / 학습 완료). | App word (catalogs), not a Go term | catalogs |
| карточка (карточка повторения) | card | カード; counter 枚 | 卡片; counter 张 | 卡片; counter 張 | 카드; counter 장 | `repetition.list` (Cards / カード / 卡片 / 卡片 / 카드), `header.dueBadge`, `repetition.learnedOf`. | App word (catalogs), not a Go term | catalogs |

---

## 5. Position names that look misleading for their moves

| line | position | issue |
|---|---|---|
| L7 | `4-4 Q16 O17 P17` "прилипание со стороны угла" | P17 is diagonal to Black's own Q16 and touches O17: it is the **kosumi-tsuke** ("kick"; SL nav SGF letter e; ja コスミツケ, zh 尖顶, ko 마늘모붙임). L42 calls the same shape against the 3-4 point "косуми-цукэ". A translator working from "attachment from the corner side" would write ツケ / 靠 / 붙임 — wrong name. Suggest "косуми-цукэ". |
| L25 | `4-4 Q16 R17 Q17 R16` "хане" | R16 is not a hane: it is White's **extension along the third line** from its own 3-3 stone R17 (ja ハイ, zh 长 / 長, ko 밀기) — the same move as L67 (`R17 Q16 Q17`, "ответ вдоль края") with the colours swapped. The hane is Black's **next** move, R15 (ja ハネ, zh 扳, ko 젖힘). A translator working from "хане" would write ハネ / 扳 / 젖힘 — wrong name. Renamed "Вторжение в 3-3 — ответ вдоль края" to match L67. |
| L44 | `3-4 Q17 Q15 O17` "прыжок в один пункт" | O17 is a one-space move **along the 3rd line** (SL: "one-space low extension"). In Japanese such a move is ヒラキ, not トビ (jaWP:トビ), so "jump" would come out as 一間トビ / 单关 / 한칸 뜀 — wrong. Suggest "раскрытие на один пункт". |
| L71 | `3-3 R17 O16 P17` "прыжок" | Same issue: P17 is a one-space move along the 3rd line toward the approach stone, sitting under it diagonally. Suggest "раскрытие на один пункт". |
| L78 | `5-4 P16 R17 Q15` "прижимание кэймой" | Q15 is a **kosumi** (diagonal) from Black's own P16; it is a knight's move only from White's 3-3 stone. In L76, L80, L90 "кэйма" means a knight's move from Black's own stone (ja ケイマガケ, ko 날일자씌움), so this caption breaks the convention and will be mistranslated. **Kept (spec 7.1):** Q15 is a knight's move from the opponent's R17 — keima-gake. |
| L83 | `5-3 … Q14 Q15` "Тайся — простой ответ" | The move is White's **kosumi-tsuke** (zhWP 大斜定式 calls it 尖顶). The caption names an evaluation, not the move, and in Japanese the classic "simple, clear" answer to the taisha is **ナラビ**, a different move (JGF:ナラビ, jaWP:大斜定石) — risk of a wrong translation. Suggest "Тайся — косуми-цукэ". |
| L51 | `3-4 … R14 Q14` "Большая лавина" | Black has only extended (R14) and White blocked (Q14). In ja/SL sources the large avalanche begins with Black's **following hane** (jaWP: "一本ノビ、白2を待って黒3とハネれば…大ナダレ"; SL: "begins with the hane"). Acceptable as an entry node, but strictly it stops one move short. |
| L21, L22, L61–L66, branches L97, L100 vs L72–L73, L110 | "Приближение через два пункта" | In the 4-4 and 3-4 groups the stone is on the 4th line (two-space **high** approach, 二間高ガカリ); in the 3-3 group (O17) it is on the 3rd line (two-space **low** approach). One Russian label covers two different terms; translators must split it. |
| L62 vs L56 / L63 | "ход в угол" (R16) / "косуми" (R16 and P16) | The same move R16 (inside kosumi) is "косуми" in L56 but "ход в угол" in L62, while in L62's group "косуми" (L63) means the outside kosumi P16. Not wrong, but inconsistent; better "косуми в угол" / "внешняя косуми". |
| L64 | "ход под камень" (R15) | Standard name is **kado** (ja カド), the knight's move that slides under the approach stone diagonally. Acceptable, but it has no standard equivalent; translators will need the kado wording above. |
| L68 | "высокое раскрытие" (Q14 from R17) | Geometrically a **large knight's move** (大ゲイマ / 大飞 / 눈목자) from the 3-3 stone; Korean even has 삼삼눈목자받음정석. "High extension" is understandable but non-standard. |
| L79 vs L91 | "прилипание" vs "прилипание снаружи" | Same move (R16 on top of the 3-3 stone) captioned differently in the 5-4 and 5-3 groups. |
| L19, L20 | "клешня" / "низкая клешня" | Underspecified, not wrong: L19 is a two-space high pincer, L20 a one-space low pincer. |

---

## Sources

Sensei's Library (fetched with curl; nav-diagram SGFs read for letter → point mapping)

- SL-CN — https://senseis.xmp.net/?ChineseGoTerms
- SL-JA — https://senseis.xmp.net/?JapaneseGoTerms
- SL-KO — https://senseis.xmp.net/?KoreanGoTerms
- SL-44LA — https://senseis.xmp.net/?44PointLowApproach (nav SGF https://senseis.xmp.net/diagrams/38/c2b5ace3e7922e32593d4498896cf3ff.sgf)
- SL-34LA — https://senseis.xmp.net/?34PointLowApproach (nav SGF https://senseis.xmp.net/diagrams/20/b20f43899ddeb5c939bb74382e084b7c.sgf)
- SL-34HA — https://senseis.xmp.net/?34PointHighApproach (nav SGF https://senseis.xmp.net/diagrams/42/7bb598ee9054b525491ead52972e0560.sgf)
- SL-33INV — https://senseis.xmp.net/?44Point33Invasion
- SL-33 — https://senseis.xmp.net/?33Point ; SL-33J — https://senseis.xmp.net/?33PointJosekis
- SL-54 — https://senseis.xmp.net/?54Point ; SL-45J — https://senseis.xmp.net/?45PointJosekis
- SL-53 — https://senseis.xmp.net/?53Point ; SL-35J — https://senseis.xmp.net/?35PointJosekis
- SL-AV — https://senseis.xmp.net/?Avalanche
- SL-MS — https://senseis.xmp.net/?MagicSword
- SL-TA — https://senseis.xmp.net/?Taisha
- SL-FK — https://senseis.xmp.net/?FlyingKnife

Japanese

- JGF:<term> — 日本囲碁連盟「囲碁用語」, https://www.ntkr.co.jp/igoyogo/yogo_N.html with N: 悪手 12, 上ヅケ 117, 受ける 120, 内ヅケ 131, 大ゲイマ 150, オサエ 166, 押し 168, カカリ 186, カケ 191, 肩ツキ 200, カド 218, 緩手 235, 形勢判断 306, ケイマ 307, コスミツケ 342, 小ナダレ 351, 小目 363, 三々 389, 秀策流 441, 定石 452, 外ヅケ 530, 大斜 540, 高ガカリ 548, 高バサミ 549, 高目 550, 高目大斜ガケ 552, ツケノビ 617, ツケ引き 618, 手抜き 669, トビツケ 697, ナダレ型 721, ナラビ 723, ハイ 770, ハサミ 786, 鼻ヅケ 799, ハメ手 816, ヒキ 835, ボウシ 885, 星 888, 目数 945
- jaWP:<title> — https://ja.wikipedia.org/wiki/<title> for: ナダレ定石, 大斜定石, ツケヒキ定石, 村正の妖刀, ダイレクト三々, コスミ, ハネ_(囲碁), ツケ, ケイマ, カカリ, ハサミ_(囲碁), ボウシ, カタツキ, オサエ, オシ_(囲碁), ハイ_(囲碁), トビ_(囲碁), ヒラキ_(囲碁), 三々, 星_(囲碁), 小目, 高目, 目外し, ハメ手, 手抜き_(ゲーム), 段級位制, 囲碁用語一覧
- CHIKUMA — 依田紀基『定石の原点』TOC (星: コスミツケ / 一間受け / 小ゲイマ受け / ツケノビ), https://www.chikumashobo.co.jp/product/9784480691521/
- KINO — 大橋成哉『碁の序盤・定石改革講座』TOC (ケイマ受け, 一間高ガカリ 上ツケ, 二間高バサミ …), https://www.kinokuniya.co.jp/f/dsg-01-9784839975210
- JA-BLOG-FK — blog post title 「飛刀定石と羋氏飛刀」, https://takusen2.seesaa.net/article/478765939.html (seen in search results only; page returned 403)

Chinese

- zhWP:<title> — https://zh.wikipedia.org/wiki/<title> for: 围棋术语, 定式 (diagram captions 单关应, 一间低夹, 尖顶, 压, 点三三, 侧飞, 尖出, 托, 靠), 飛刀定式, 大斜定式, 妖刀定式, 雪崩定式, 小目, 尖_(围棋), 飞_(围棋), 拆_(围棋), 挂角, 复盘, 段级位制, 本因坊秀策, 目外, 高目, 星位, 布局_(围棋) (also its zh-tw version 布局 (圍棋))
- 163 — Chinese article on the four answers to the 4-4 small knight approach (小飞守角, 单关守角, 大飞守角, 大跳守角), https://www.163.com/dy/article/G48LBI3O0529BOGK.html
- BILI — 方天丰 lecture series titles (托退, 外靠, 压长, 大飞挂, 二间高挂, 一间高夹, 肩冲, 镇, 点33), https://www.bilibili.com/video/av64603949/
- ITH — "盘面领先18目半", https://www.ithome.com/0/979/661.htm
- DIQT — dictionary entry 骗招 = ハメ手 (search snippet), https://www.diqt.net/en/words/1964588

Korean

- koWP:<title> — https://ko.wikipedia.org/wiki/<title> for: 바둑 용어 (term navbox), 날일자씌움, 눈목자씌움, 외목날일자씌움정석, 밑붙임, 위붙임, 붙여끌기, 붙여뻗기, 코붙임, 마늘모, 마늘모붙임, 이단젖힘, 젖힘, 막음, 끌기, 벌림, 두칸벌림, 한칸뜀, 걸침, 한칸높은걸침, 두칸높은걸침, 낮은협공, 높은협공, 날일자받음, 눈목자받음, 화점한칸뛰어받음정석, 삼삼날일자받음정석, 삼삼어깨밀기정석, 어깨짚기, 요도정석, 대사정석, 눈사태_정석, 화점정석, 함정수, 형세판단, 고목, 외목, 화점, 침입, 혼인보_슈사쿠, 바둑_용어_목록, 악수_(바둑), 완착, 패착
- namu:화점정석 — https://namu.wiki/w/화점정석 (날일자 걸침/받음, 붙여뻗기, 함정수 "당하고 만다", 정수, 한칸 받음, 삼삼 침입)
- DAUM — 복기(復棋) vs 復盤 vs 検討, https://v.daum.net/v/20260627061703454 (search snippet)
- KD — "백 2집반 우세", https://www.koreadaily.com/article/20260616080211453 (search snippet; page now returns 410)

Multilingual / software

- GM:<slug> — GoMagic glossary, https://gomagic.org/go-term/<slug>/ (used for cross-checks only; several of its entries — ko 대기사, 큰 깩끼, zh 大桂馬掛, zh 外目 — are contradicted by primary sources)
- KT — KaTrain locales (cn, tw, jp, ko), https://github.com/sanderland/katrain/tree/master/katrain/i18n/locales
- LZ — Lizzie localisation (zh_CN, ja_JP, ko), https://github.com/featurecat/lizzie/tree/master/src/main/resources/l10n
- catalogs — the app's own message catalogs, `packages/shared/src/i18n/{ru,en,ja,ko,zh-Hans,zh-Hant}.ts`: the rows marked "App word" give the words they use for app terms that are not Go terms.
- enWP:Taisha — https://en.wikipedia.org/wiki/Taisha_jōseki ; enWP:Nadare — https://en.wikipedia.org/wiki/Nadare_jōseki ; enWP:Joseki — https://en.wikipedia.org/wiki/Jōseki

---

## Appendix: the named start list by line (L1–L110)

The `Lnn` references above are the line numbers of this listing.

```text
L1  # Named start positions of Joseki Dojo (canonical: top-right corner, Black first, GTP coordinates on 19x19, columns A-T without I).
L2  # group | moves | full name (ru) | short caption (ru) | rare
L3  
L4  4-4 | Q16 O17 Q14 | Малое приближение — прыжок в один пункт | Прыжок в один пункт | 
L5  4-4 | Q16 O17 R14 | Малое приближение — ответ кэймой | Ответ кэймой | 
L6  4-4 | Q16 O17 R13 | Малое приближение — ответ большой кэймой | Ответ большой кэймой | 
L7  4-4 | Q16 O17 P17 | Малое приближение — прилипание со стороны угла | Прилипание со стороны угла | 
L8  4-4 | Q16 O17 O16 | Малое приближение — прилипание снаружи | Прилипание снаружи | 
L9  4-4 | Q16 O17 O15 | Малое приближение — шапка | Шапка | rare
L10  4-4 | Q16 O17 P15 | Малое приближение — косуми | Косуми | rare
L11  4-4 | Q16 O17 P18 | Малое приближение — кэйма снизу | Кэйма снизу | rare
L12  4-4 | Q16 O17 R17 | Малое приближение — косуми в 3-3 | Косуми в 3-3 | rare
L13  4-4 | Q16 O17 M17 | Малое приближение — низкая клешня в один пункт | Низкая клешня в один пункт | 
L14  4-4 | Q16 O17 M16 | Малое приближение — высокая клешня в один пункт | Высокая клешня в один пункт | 
L15  4-4 | Q16 O17 L17 | Малое приближение — низкая клешня в два пункта | Низкая клешня в два пункта | 
L16  4-4 | Q16 O17 L16 | Малое приближение — высокая клешня в два пункта | Высокая клешня в два пункта | 
L17  4-4 | Q16 O17 K17 | Малое приближение — низкая клешня в три пункта | Низкая клешня в три пункта | 
L18  4-4 | Q16 O17 K16 | Малое приближение — высокая клешня в три пункта | Высокая клешня в три пункта | 
L19  4-4 | Q16 O16 L16 | Высокое приближение — клешня | Клешня | rare
L20  4-4 | Q16 O16 M17 | Высокое приближение — низкая клешня | Низкая клешня | rare
L21  4-4 | Q16 N16 Q14 | Приближение через два пункта — прыжок | Прыжок | rare
L22  4-4 | Q16 N16 R13 | Приближение через два пункта — ответ большой кэймой | Ответ большой кэймой | rare
L23  4-4 | Q16 N17 R13 | Большое приближение — ответ большой кэймой | Ответ большой кэймой | rare
L24  4-4 | Q16 R17 Q17 | Вторжение в 3-3 — блок | Блок | 
L25  4-4 | Q16 R17 Q17 R16 | Вторжение в 3-3 — хане | Хане | 
L26  4-4 | Q16 R17 Q17 R16 R15 S15 | Вторжение в 3-3 — хане по второй линии | Хане по второй линии | 
L27  4-4 | Q16 R17 Q17 R16 R15 S15 S14 | Вторжение в 3-3 — двойное хане | Двойное хане | 
L28  4-4 | Q16 R17 Q17 R16 R14 | Вторжение в 3-3 — ответ кэймой | Ответ кэймой | 
L29  4-4 | Q16 R17 Q17 R16 R14 S14 | Вторжение в 3-3 — прилипание под кэйму | Прилипание под кэйму | 
L30  4-4 | Q16 R17 Q17 R16 R14 S14 S13 R15 | Летящий нож | Летящий нож | 
L31  4-4 | Q16 O17 M17 R17 | Низкая клешня в один пункт — вторжение в 3-3 | Вторжение в 3-3 | 
L32  3-4 | Q17 R15 P16 | Малое приближение — косуми Сюсаку | Косуми Сюсаку | 
L33  3-4 | Q17 R15 O16 | Малое приближение — ответ кэймой | Ответ кэймой | 
L34  3-4 | Q17 R15 N17 | Малое приближение — раскрытие на два пункта | Раскрытие на два пункта | 
L35  3-4 | Q17 R15 R13 | Малое приближение — низкая клешня в один пункт | Низкая клешня в один пункт | 
L36  3-4 | Q17 R15 R12 | Малое приближение — низкая клешня в два пункта | Низкая клешня в два пункта | 
L37  3-4 | Q17 R15 R11 | Малое приближение — низкая клешня в три пункта | Низкая клешня в три пункта | 
L38  3-4 | Q17 R15 Q13 | Малое приближение — высокая клешня в один пункт | Высокая клешня в один пункт | 
L39  3-4 | Q17 R15 Q12 | Малое приближение — высокая клешня в два пункта | Высокая клешня в два пункта | 
L40  3-4 | Q17 R15 Q11 | Малое приближение — высокая клешня в три пункта | Высокая клешня в три пункта | 
L41  3-4 | Q17 R15 Q15 | Малое приближение — прилипание сверху | Прилипание сверху | 
L42  3-4 | Q17 R15 R16 | Малое приближение — косуми-цукэ | Косуми-цукэ | 
L43  3-4 | Q17 Q15 O16 | Высокое приближение — ответ кэймой | Ответ кэймой | 
L44  3-4 | Q17 Q15 O17 | Высокое приближение — прыжок в один пункт | Прыжок в один пункт | 
L45  3-4 | Q17 Q15 R15 | Высокое приближение — прилипание снизу | Прилипание снизу | 
L46  3-4 | Q17 Q15 R15 R14 | Прилипание снизу — хане | Хане | 
L47  3-4 | Q17 Q15 R15 R14 R16 | Прилипание снизу — хане и отход | Отход | 
L48  3-4 | Q17 Q15 R15 Q16 | Прилипание снизу — начало лавины | Начало лавины | 
L49  3-4 | Q17 Q15 R15 Q16 R16 P17 | Лавина — выбор между малой и большой | Выбор лавины | 
L50  3-4 | Q17 Q15 R15 Q16 R16 P17 Q14 | Малая лавина | Малая лавина | 
L51  3-4 | Q17 Q15 R15 Q16 R16 P17 R14 Q14 | Большая лавина | Большая лавина | 
L52  3-4 | Q17 Q15 P15 | Высокое приближение — прилипание сверху | Прилипание сверху | 
L53  3-4 | Q17 Q15 R13 | Высокое приближение — низкая клешня в один пункт | Низкая клешня в один пункт | 
L54  3-4 | Q17 Q15 Q13 | Высокое приближение — высокая клешня в один пункт | Высокая клешня в один пункт | 
L55  3-4 | Q17 Q15 Q12 | Волшебный меч Мурамасы | Меч Мурамасы | 
L56  3-4 | Q17 R14 R16 | Большое приближение — косуми | Косуми | 
L57  3-4 | Q17 R14 Q15 | Большое приближение — удар в плечо | Удар в плечо | 
L58  3-4 | Q17 R14 R12 | Большое приближение — клешня в один пункт | Клешня в один пункт | 
L59  3-4 | Q17 R14 Q12 | Большое приближение — высокая клешня в один пункт | Высокая клешня в один пункт | rare
L60  3-4 | Q17 R14 Q11 | Большое приближение — высокая клешня в два пункта | Высокая клешня в два пункта | 
L61  3-4 | Q17 Q14 O16 | Приближение через два пункта — ответ кэймой | Ответ кэймой | 
L62  3-4 | Q17 Q14 R16 | Приближение через два пункта — ход в угол | Ход в угол | rare
L63  3-4 | Q17 Q14 P16 | Приближение через два пункта — косуми | Косуми | rare
L64  3-4 | Q17 Q14 R15 | Приближение через два пункта — ход под камень | Ход под камень | 
L65  3-4 | Q17 Q14 P14 | Приближение через два пункта — прилипание к голове | Прилипание к голове | rare
L66  3-4 | Q17 Q14 R12 | Приближение через два пункта — низкая клешня | Низкая клешня | 
L67  3-3 | R17 Q16 Q17 | Удар в плечо — ответ вдоль края | Ответ вдоль края | 
L68  3-3 | R17 O16 Q14 | Большое приближение — высокое раскрытие | Высокое раскрытие | 
L69  3-3 | R17 O16 R14 | Большое приближение — раскрытие | Раскрытие | 
L70  3-3 | R17 O16 Q15 | Большое приближение — ответ кэймой | Ответ кэймой | rare
L71  3-3 | R17 O16 P17 | Большое приближение — прыжок | Прыжок | rare
L72  3-3 | R17 O17 Q15 | Приближение через два пункта — ответ кэймой | Ответ кэймой | 
L73  3-3 | R17 O17 R14 | Приближение через два пункта — раскрытие | Раскрытие | 
L74  5-4 | P16 R16 R17 | Приближение — прилипание изнутри | Прилипание изнутри | 
L75  5-4 | P16 R16 R15 | Приближение — прилипание снаружи | Прилипание снаружи | 
L76  5-4 | P16 R16 Q14 | Приближение — прижимание кэймой | Прижимание кэймой | 
L77  5-4 | P16 R16 Q13 | Приближение — прижимание большой кэймой | Прижимание большой кэймой | rare
L78  5-4 | P16 R17 Q15 | Вторжение в 3-3 — прижимание кэймой | Прижимание кэймой | rare
L79  5-4 | P16 R17 R16 | Вторжение в 3-3 — прилипание | Прилипание | rare
L80  5-3 | P17 R16 Q15 | Приближение — прижимание кэймой | Прижимание кэймой | 
L81  5-3 | P17 R16 Q14 | Тайся | Тайся | 
L82  5-3 | P17 R16 Q14 P16 | Тайся — прилипание | Прилипание | 
L83  5-3 | P17 R16 Q14 Q15 | Тайся — простой ответ | Простой ответ | 
L84  5-3 | P17 R16 R14 | Приближение — низкая клешня в один пункт | Низкая клешня в один пункт | 
L85  5-3 | P17 R16 R13 | Приближение — низкая клешня в два пункта | Низкая клешня в два пункта | 
L86  5-3 | P17 R16 R12 | Приближение — низкая клешня в три пункта | Низкая клешня в три пункта | 
L87  5-3 | P17 R16 Q13 | Приближение — высокая клешня в два пункта | Высокая клешня в два пункта | 
L88  5-3 | P17 Q15 R16 | Высокое приближение — ответ кэймой | Ответ кэймой | rare
L89  5-3 | P17 Q15 R17 | Высокое приближение — ответ в 3-3 | Ответ в 3-3 | rare
L90  5-3 | P17 R17 Q15 | Вторжение в 3-3 — прижимание кэймой | Прижимание кэймой | 
L91  5-3 | P17 R17 R16 | Вторжение в 3-3 — прилипание снаружи | Прилипание снаружи | rare
L92  
L93  # Branches (tree nodes that are not positions): moves | name (ru)
L94  Q17 R15 | Малое приближение
L95  Q17 Q15 | Высокое приближение
L96  Q17 R14 | Большое приближение
L97  Q17 Q14 | Приближение через два пункта
L98  Q16 O17 | Малое приближение
L99  Q16 O16 | Высокое приближение
L100  Q16 N16 | Приближение через два пункта
L101  Q16 N17 | Большое приближение
L102  Q16 R17 | Вторжение в 3-3
L103  P17 R16 | Приближение
L104  P17 Q15 | Высокое приближение
L105  P17 R17 | Вторжение в 3-3
L106  P16 R16 | Приближение
L107  P16 R17 | Вторжение в 3-3
L108  R17 Q16 | Удар в плечо
L109  R17 O16 | Большое приближение
L110  R17 O17 | Приближение через два пункта
```
