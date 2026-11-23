#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Merge the 2026-11-20 Obsidian style note into prompts.json without wiping library items."""
from __future__ import annotations

import json
import sys
from collections import Counter, OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROMPTS = ROOT / "public" / "data" / "prompts.json"
META = ROOT / "public" / "data" / "meta.json"
PROGRESS = ROOT / "scripts" / "imagine-progress.json"
BATCH = ROOT / "scripts" / "imagine-batches" / "obsidian-20261120.json"
INBOX = ROOT / "covers-inbox"
SOURCE = "obsidian-20261120.md"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parse_prompts import STYLE_VOCAB, MEDIUMS, COLLECTION_NAMES, build_meta, build_tags  # noqa: E402

SOURCE_NOTE = "来源：用户 Obsidian 笔记（2026-11-20）。"


def item(
    *,
    id: str,
    category: str,
    category_slug: str,
    title: str,
    usage: str,
    body: str,
    prompt_text: str,
    tags: list[str],
    medium: str,
    aspect: str | None = None,
    parent_id: str | None = None,
    collection: str | None = None,
    collection_index: int | None = None,
    collection_total: int | None = None,
) -> dict:
    return {
        "id": id,
        "category": category,
        "categorySlug": category_slug,
        "title": title,
        "usage": usage,
        "body": body.strip(),
        "source": SOURCE,
        "cover": None,
        "parentId": parent_id,
        "collection": collection,
        "collectionIndex": collection_index,
        "collectionTotal": collection_total,
        "tags": build_tags(category, collection, medium, aspect, tags),
        "medium": medium,
        "aspect": aspect,
        "promptText": prompt_text.strip(),
        "duplicateNote": None,
        "duplicateOf": None,
    }


SHAO_INTRO = (
    "这次参考的是胡金铨导演在邵氏时期武侠代表之作《大醉侠》以及他参与执导的最后武侠之作"
    "《笑傲江湖》1990版。同时又加入了一点巨物奇观。"
)

SHAO_PROMPTS = [
    (
        "01",
        "邵氏赛博｜市井寻仇",
        "邵氏电影风格，赛博江湖市井寻仇场景，侠客正面立于热闹市井中，目光锐利锁定前方（镜头外的仇人），腰间机械剑鞘泛霓虹光，衣袍下摆沾泥渍，身旁是挂全息招牌的小吃摊与穿梭的行人，远处有机械巡检飞虫掠过，复古胶片颗粒，俯拍中景镜头，暖调烟火光影与冷调人物情绪对比，30%赛博元素（机械剑鞘、全息招牌、巡检飞虫），还原江湖人隐于市井寻仇的紧张感",
    ),
    (
        "02",
        "邵氏赛博｜千人巡游",
        "邵氏电影风格，赛博江湖市井千人巡游场景，高空俯视跟拍构图（镜头从高空跟随巡游队伍移动），长街之上上千名侠客组成巡游队伍，身着统一嵌霓虹暗纹的劲装，手持荧光剑与机械旗，街道两侧挂满红灯笼、全息招牌与赛博霓虹广告，人流涌动，远处有古桥与悬浮赛博巡逻车，复古胶片颗粒，暖调烟火光影，电影级跟拍运镜，30%赛博元素融入服饰、旗帜与巡逻车，场面恢弘，市井气息与科幻感兼具，适配MJ",
    ),
    (
        "03",
        "邵氏赛博｜古战场机甲武士",
        "邵氏武侠电影风格，赛博朋克武侠，冷色调青蓝黑金，破败古战场与巨型赛博城门，阴雨浓雾，史诗级宏大画面，电影级光影，低角度远景，身披黑色斗篷的赛博机甲武士，全身金属机甲与暗金纹路，面部半遮面，手持巨型横刀，骑乘机械战马，机甲与生物混合结构，马蹄踏碎电光，披风狂舞，刀身泛冷光，画面震撼，细节拉满，8K，超写实",
    ),
    (
        "04",
        "邵氏赛博｜武林大会",
        "邵氏电影风格，赛博江湖宏大武林大会场景，高空俯视全景构图，青石板广场上聚集上千名侠客，身着嵌霓虹暗纹的古风劲装，中央高台立着带机械纹路的比武台，台边悬挂巨型霓虹幡旗与全息武林榜，四周古建屋顶缠绕霓虹光带，远处悬浮赛博飞艇与机械飞虫巡逻，复古胶片颗粒，电影级光影，高对比度，30%赛博元素融入服饰、道具与环境，场面恢弘，尽显江湖磅礴气势，适配MJ",
    ),
    (
        "05",
        "邵氏赛博｜巨型江湖主城",
        "赛博古风巨型江湖主城，千年古城墙与浮空机甲塔楼交错，飞檐挂霓虹灯带，空中悬浮飞剑与飞艇，云雾缭绕，远山如墨，超广角史诗大场景，8K 写实，细节爆炸",
    ),
    (
        "06",
        "邵氏赛博｜雨夜古街",
        "雨夜赛博古风古街，青石板路反光，油纸伞与全息投影广告并存，红灯笼与霓虹招牌交错，水雾弥漫，暗调电影感，热闹又孤寂的江湖氛围",
    ),
    (
        "07",
        "邵氏赛博｜云海虹桥",
        "云海虹桥，白玉长桥连接浮空仙岛，桥下是翻滚云浪与流光星河，桥身嵌发光阵纹，仙气与科技完美融合，天堂级史诗画面",
    ),
]

XIANXIA_PROMPTS = [
    (
        "01",
        "仙侠繁华｜松枝框景隐仙宫",
        "framing composition, ancient pine branches as foreground occlusion, grand hidden celestial palace behind mist, glowing palace lights leak through cloud gaps, full starry sky above, pool reflection at bottom of frame, real night outdoor photography, rich layering of light and shadow",
    ),
    (
        "02",
        "仙侠繁华｜云岛天宫俯拍",
        "vertical top-down shot, single grand heavenly palace stands on isolated giant cloud island, surrounded by boundless rolling cloud sea, small water pools around palace courtyard, distant faint nebula in night sky, warm golden lamplight from palace windows, photorealistic atmospheric perspective",
    ),
    (
        "03",
        "仙侠繁华｜星夜仙宫倒影",
        "ultra realistic landscape photography, grand floating ancient Chinese celestial palace clusters, blue glazed tile roofs with golden decorative carvings, warm lantern lights shining from doors and windows, vast starry night sky, flowing milky way, thick rolling clouds wrap around building bases, quiet fairy pond in foreground, complete palace reflection on calm water, deep indigo color grading, natural night atmosphere, cinematic ambient occlusion, 8k high detail",
    ),
    (
        "04",
        "仙侠繁华｜群宫云岛航拍",
        "top-down aerial overhead shot, grand clustered ancient Chinese celestial palaces, blue glazed tile roofs carved with golden dragon patterns, elaborate dougong and upturned eaves, numerous floating cloud islands connected by carved jade arch bridges, winding mist lingering in valley gaps between clouds, tranquil fairy lake reflecting twinkling stars and palace outlines, boundless starry sky with glowing milky way and faint nebula, warm golden lamplight spilling from palace doors and windows",
    ),
]

GUFENG_ATMO = """参考图中人物脸部，头发和衣服，神态慵懒淡然、嘴唇紧闭，又带着一丝疏离狡黠。
柔和春日侧逆光，丁达尔柔光，
浅景深柔焦，发丝根根分明，
皮肤通透细腻，光影层次极致
，8K超清，极致细节，
清冷温柔又桀骜不羁的江湖仙侠氛围感
采用细腻皮肤真实质感的风格，画面中展现了
一个不改变原图形象的脸部特写
通过略微仰视镜头的角度进行呈现，
人物微微抬头，打一把油纸伞。或者看向镜头，又或者低头。背景营造出清醒系且阳光的场景氛围。
有着散乱的头发随风飘动的感觉，
发型不变，发丝随风飘动，不改变原片发色，
她的眼神闪闪发光，其中带着阳光和魅惑的情绪。
尽显魅惑高冷的气质画着重勾勒的面部细节，
高先处理十分讲究，
同时画面呈现出带有摄像机极蓝噪点的画质，
并且有着白色通透效果，
不要改变人脸，超广角，背景为蓝天，原比例，生成九张"""

HU_JINQUAN = "35毫米粗粒胶片，模拟物理显影效果，大地色与苍青色，画面古朴冷峻肃杀。侧逆光布光，高对比度、烟雾散射、强光线，强化明暗交界。前景遮挡、极简构图、留白、风吹动的自然动势。使大地色与苍青色呈现出厚重且克制的层次感"

TSUI_HARK = """14MM超广角和极地仰拍（LOW ANGLE SHOT）.利用倾斜，失衡的构图，增强画面感。
使用漂白过曝的废土色调，和强烈的逆光高光溢出。
采用胶片颗粒和动态模糊"""

LIGHT_GUFENG = """帮我将图片中的人物生成柔焦朦胧质感的人像照片，采用图片中的人物脸部五官 最终生成人物的五官要与图片中的人物脸部百分百相似 画面范围为肩部以上特写，突出半张侧脸与手部动作，氛围感浓郁，也有原图与图中衣服一样，女生露出右侧半张脸，尽显娇憨慵懒；微垂双眼，眼尾被发丝遮挡，只露出浓密纤长的睫毛，眼神温柔松弛。白发自然蓬松，几缕细碎发丝散落在脸颊和额前，部分发丝在光线照耀下泛着白色柔光，发梢在柔焦效果下朦胧虚化。
采用侧逆光打光，冷白色柔光从画面右侧斜向照射，在发丝边缘、鼻梁和手指上形成明显光晕，面部明暗对比柔和，弱化轮廓线条，增强朦胧感。背景为纯色米色墙面，无其他元素，因柔焦轻微模糊虚化，与人物主体形成虚实对比，突出温柔气质。
整体风格温柔、慵懒、朦胧，如同午后阳光下的随意抓拍，充满复古甜美的少女气息与松弛治愈氛围。画面比例 9:16。
（选择描述：胶片摄影质感，轻微颗粒感，高柔焦，低对比度，高光柔化，逆光发丝发光效果，浅景深，电影感氛围，INS风人像。
柯达金200胶片色调，暖调柔光，轻微曝光过度，皮肤质感通透，日系写真风，镜头光晕，柔焦滤镜，前景轻微虚化，画面边缘柔化） 生成十张图片"""

FAXIANG = """分镜一：结印觉醒 (0-5秒)
特写镜头，缓慢推进。一位绝美二次元仙侠女子悬浮于苍穹之上，双眼微闭，双手在胸前快速结出残影般的法印。突然她双目怒睁，瞳孔射出耀眼金光，眉心的神罚印记被点亮。周身卷起灵力飓风，吹动她的青色流仙长裙和黑色长发剧烈狂飞。极高画质，面部五官极其精致，史诗感氛围。

分镜二：法相拔地而起 (5-10秒)
镜头从绝世容颜二次元古风女子身前快速向后拉远，并转为仰拍。随着女子双臂猛然向两侧展开，她背后的空间如同镜面般碎裂。一尊高达万千丈、散发着刺目金光的半透明神女法相虚影，以排山倒海之势从她身后拔地而起，身躯庞大到遮天蔽日。巨大的法相与微小的女子形成极其强烈的比例反差，带来强烈的巨物压迫感。

分镜三：天地神威 (10-15秒)
超广角镜头，缓慢环绕飞行拍摄。完全成型的万丈黄金法相矗立在破碎的天地之间，低头俯视苍生。法相缓缓睁开双眸，一道圆形的金色能量气浪以法相为中心向四面八方轰然炸开，瞬间驱散了天空中所有的压抑黑云，无数古老的金色符文和粗壮的雷电在法相周围环绕。画面庄严肃穆，神圣不可侵犯，极致的破坏力与视觉震撼，慢动作"""

MICRO_EXPR = """0-2秒：低头垂眸，嘴角噙着含蓄淡笑，不露齿，神态温柔安静。
2-4秒：笑意缓缓收敛，嘴角归平；双眼、头部慢慢抬起，视线转向画面右侧，神情转为认真留意。
4-6秒：持续望向右方，眼神添上浅淡疑惑与担忧，双眼微睁（幅度自然），嘴唇轻启呈欲言又止状，眉眼微收，不皱眉。
6-8秒：视线缓缓下沉，头部微低，笑意尽数褪去，神情安静失落，内敛压抑情绪，不流泪、不哭泣。
8-10秒：低头轻阖双眼，平复心绪，嘴角浮现一抹藏起难过的浅淡自嘲式浅笑，呼吸自然，动作极轻。
10-12秒：缓缓抬头，眼眸重新迎向柔光，眼神渐亮却依旧克制，面部转向前方/偏右，唇角带一丝温柔又委屈的淡意。
12-15秒：目视前方/画面右侧，眼神柔和微润，唇瓣轻动似欲语还休，最终保持安静凝视状态，定格在温柔清冷、略带忧郁的情绪中，结尾无黑屏、无转场。"""

YANCAI = "岩刻神明少女| 岩彩画；染料染成的青蓝，被岁月浸软，被风沙吹皱，在鎏金的碎光里，像一片翻涌的浪。当风穿过洞窟，当月光照进画里，当鎏金的颜料在光里流动"

DREAM_GUFENG = """大梦长明，云海无波 悬城半壁，灯火千家。我们在云端筑城，在星空挂瀑，用仙法造出一个纤毫毕现的幻梦，却终究造不出一丝人间烟火的暖意。
你看那长廊上徘徊的影，看那楼台间明灭的灯，多像一场盛大的海市蜃楼。当修仙者站得足够高，高到能俯瞰星辰的轨迹、地球的流转，时间便不再是奔流的河，而是一潭死水。
没有生老病死的惊澜，便没有悲欢离合的涟漪。这天宫里的每一寸华丽，都在无声地叩问：如果永恒意味着静止，如果极乐意味着无感，那这漫长的存在，与虚无何异？
仙非仙，梦非梦，不过是天地间一抹华丽的苍凉。"""

LOTR = "【天气规则】阴天，柔光，有少量薄雾冷灰绿史诗色调，低饱和阴天柔光，高光降低，绿色向灰橄榄色偏移。【影视与摄影质感】院线正片8K画质，ARRI Alexa 65 IMAX 摄影机拍摄，35mm 富士电影胶片，柔和自然光影，轻微胶片颗粒，24 帧自然动态模糊，好莱坞院线级真人实拍质感， 实拍质感：35mm 定焦电影镜头，f/1.4 恒定大光圈，景深雾气自然虚化；35mm 富士胶片颗粒均匀覆盖，自然动态拖影。实景搭景 + 实体道具 + 后期视效合成，物理光影真实，电影级布光,Lumen 全局光照，HDR 照明，轮补光，柔和主光源。"

YONEYAMA = """**STYLE LOCK：**
高完成度数字动漫插画风格，以精致赛璐璐平涂为基础，融合柔和渐变、局部厚涂修饰、透明叠色与平面装饰设计；造型语言强调流畅、延展、富有曲线张力与方向性的形体概括，允许适度比例与透视夸张，但始终保持结构清晰、视觉协调。使用清晰而富有变化的勾线，外轮廓相对明确，内部结构线更细、更轻，通过粗细变化、断线、失线、色线与局部弱化避免机械描边；局部可加入纤细装饰线、自由曲线、碎片化轮廓与几何切面增强节奏。色彩采用高纯度主色与低纯度过渡色并置，冷暖关系大胆但整体统一，允许青蓝、紫、粉、橙黄、青绿等色相形成偏移、互补与局部跳色；阴影不依赖单纯黑灰，而以具有色相倾向的冷暖色块组织明暗，通过大面积平涂暗部、少量柔和渐变和局部高亮建立层次。亮部具有通透、轻盈、偏发光感的综合色彩，高光可出现冷暖偏色、虹彩感、边缘色散和轻微辉光，但避免全面写实反射。表面起伏与材质差异主要依靠色块切分、明度分区、透明叠色、局部高光与少量纹理进行抽象表现，不追求物理写实材质模拟。画面强调图形化与绘画性的结合，大形体优先，局部细节集中于视觉焦点，次要区域允许概括、留白、失焦或降低线条密度；通过前后遮挡、尺寸变化、明暗反差、色彩纯度差异和边缘虚实建立空间层次，而非依赖完全写实的空气透视。整体可融入流体状、弧线状、晶体状、碎片状、光斑状、波纹状、几何切面状等非具象装饰图形，但仅作为抽象视觉节奏，不绑定任何具体题材。局部加入轻微颗粒、网点、纸张或扫描质感、喷绘噪点、色边错位、微弱色散与印刷感，使数字画面保留手工插画的不规则性；边缘控制采用硬边、软边、失边并置，主体结构区域清晰，外围与高亮区域可适度溶解。整体追求高信息密度但不平均铺满，以大色块、曲线节奏、装饰性负形、强弱对比和局部精细刻画形成视觉重心，呈现明亮、华丽、梦幻、灵动、略带实验性平面设计感的高完成度现代数字插画质感。"""

LIVE_LIGHT = "整体画面强调真实摄影感、非CG塑料感、非动漫感，人物皮肤保留真实细节：细微毛孔、泪沟、鼻翼阴影、唇纹、人物皮肤哑光、眼周细小纹理、人物自然眨眼、自然血色与真实高光，头发具备真实发丝层次。轻微胶片颗粒感，anamorphic lens flare，8K超清写实画质。自然主义真人实拍电影质感画面整体色调采用低饱和暖中性色调，全局彩度偏低，黑位略抬，中间调柔和丰厚，高光明亮但不过曝，保留窗边亮部层次和室内暗部细节。使用单一方向的大面积柔和日光作为主光，光线从侧后方或侧方进入，形成自然侧光或侧逆光，正面补光极弱，仅依赖环境反射回填，阴影边缘柔和，整体光比克制，禁止使用舞台式聚光或明显轮廓光。场景材质设定：材质表现真实自然，皮肤、织物、木材、瓷面和玻璃均为哑光或半哑光反射，锐度中等偏柔，微反差降低，允许极轻微光学柔化和细小胶片感颗粒，整体后期偏低反差、轻胶片气质、弱数码锐利感，呈现安静、亲密、生活化且富有电影叙事感的影像风格。"

SOFT_LIVE = "自然主义真人实拍电影质感，安静、温和、克制的日常生活氛围，整体采用低饱和暖中性色调，以米白、奶油白、浅灰、浅卡其、暖木色、低饱和蓝灰和淡鼠尾草绿为主色；全局彩度偏低，黑位略抬，中间调柔和丰厚，高光明亮但不过曝，保留窗边亮部层次和室内暗部细节。使用单一方向的大面积柔和日光作为主光，光线从侧后方或侧方进入，形成自然侧光或侧逆光，正面补光极弱，仅依赖环境反射回填，阴影边缘柔和，整体光比克制，不使用舞台式聚光或明显轮廓光。构图强调环境叙事与真实空间层次，采用平视或略低平视机位，中景到中近景，35—50mm全画幅等效的自然镜头空间感，中浅到中等景深，主体平面清晰，前景和远端轻柔虚化，允许前景遮挡与器物层叠。材质表现真实自然，皮肤、织物、木材、瓷面和玻璃均为哑光或半哑光反射，锐度中等偏柔，微反差降低，允许极轻微光学柔化和细小胶片感颗粒，整体后期偏低反差、轻胶片气质、弱数码锐利感，呈现安静、亲密、生活化且富有电影叙事感的影像风格。"


def build_items() -> list[dict]:
    items: list[dict] = []
    total = len(SHAO_PROMPTS)
    for idx, (num, title, prompt) in enumerate(SHAO_PROMPTS, start=1):
        body = f"{SOURCE_NOTE}\n\n**合集说明**：{SHAO_INTRO}\n\n**提示词**：\n{prompt}"
        style = ["古风", "科幻", "电影感", "摄影"]
        if "适配MJ" in prompt:
            style.append("Midjourney")
        if "主城" in title or "云海" in title:
            style.append("巨构")
        items.append(
            item(
                id=f"changjing-9-{num}",
                category="MJ",
                category_slug="mj",
                title=title,
                usage="环境 / 地点 / 场景类视觉",
                body=body,
                prompt_text=prompt,
                tags=style,
                medium="图像",
                parent_id="changjing-9",
                collection="邵氏赛博",
                collection_index=idx,
                collection_total=total,
            )
        )

    total = len(XIANXIA_PROMPTS)
    for idx, (num, title, prompt) in enumerate(XIANXIA_PROMPTS, start=1):
        items.append(
            item(
                id=f"changjing-10-{num}",
                category="场景",
                category_slug="changjing",
                title=title,
                usage="环境 / 地点 / 场景类视觉",
                body=f"{SOURCE_NOTE}\n\n**提示词**：\n{prompt}",
                prompt_text=prompt,
                tags=["仙侠", "古风", "摄影", "电影感"],
                medium="图像",
                parent_id="changjing-10",
                collection="仙侠繁华试",
                collection_index=idx,
                collection_total=total,
            )
        )

    items.append(
        item(
            id="changjing-11",
            category="场景",
            category_slug="changjing",
            title="梦幻古风",
            usage="环境 / 地点 / 场景类视觉",
            body=f"{SOURCE_NOTE}\n\n{DREAM_GUFENG}",
            prompt_text=DREAM_GUFENG,
            tags=["古风", "仙侠", "电影感"],
            medium="图像",
        )
    )

    items.append(
        item(
            id="renwu-29",
            category="人物",
            category_slug="renwu",
            title="古风氛围感画面",
            usage="角色设定 / 人像精修 / 人物渲染",
            body=f"{SOURCE_NOTE}\n\n此条依赖参考人物图（脸部、头发与衣服）。提示词中的「生成九张」为原用法说明，图鉴封面只保留一张代表图。\n\n**提示词**：\n{GUFENG_ATMO}",
            prompt_text=GUFENG_ATMO,
            tags=["人像", "古风", "仙侠", "摄影", "图生图"],
            medium="图生提示词",
        )
    )

    items.append(
        item(
            id="renwu-30",
            category="人物",
            category_slug="renwu",
            title="光影古风氛围",
            usage="角色设定 / 人像精修 / 人物渲染",
            body=f"{SOURCE_NOTE}\n\n此条依赖参考人物图，要求五官与参考图一致。提示词中的「生成十张图片」为原用法说明，图鉴封面只保留一张代表图。\n\n**提示词**：\n{LIGHT_GUFENG}",
            prompt_text=LIGHT_GUFENG,
            tags=["人像", "古风", "摄影", "电影感", "图生图"],
            medium="图生提示词",
            aspect="9:16",
        )
    )

    items.append(
        item(
            id="renwu-31",
            category="人物",
            category_slug="renwu",
            title="真人微表情",
            usage="角色设定 / 人像精修 / 人物渲染",
            body=f"{SOURCE_NOTE}\n\n15 秒微表情视频提示词，按时间轴使用，保持为一条。\n\n**提示词**：\n{MICRO_EXPR}",
            prompt_text=MICRO_EXPR,
            tags=["人像", "写实", "摄影", "分镜"],
            medium="视频",
        )
    )

    items.append(
        item(
            id="texiao-2",
            category="特效",
            category_slug="texiao",
            title="玄幻法相",
            usage="光效 / 能量 / 法术特技",
            body=f"{SOURCE_NOTE}\n\n15 秒三段分镜视频提示词，保持为一条。\n\n{FAXIANG}",
            prompt_text=FAXIANG,
            tags=["仙侠", "特效", "分镜", "二次元"],
            medium="视频",
        )
    )

    items.append(
        item(
            id="yishu-43",
            category="艺术",
            category_slug="yishu",
            title="胡金铨风格",
            usage="插画风 / 艺术字 / 艺术海报",
            body=f"{SOURCE_NOTE}\n\n**风格提示词**：\n{HU_JINQUAN}",
            prompt_text=HU_JINQUAN,
            tags=["古风", "电影感", "摄影", "写实"],
            medium="图像",
        )
    )

    items.append(
        item(
            id="yishu-44",
            category="艺术",
            category_slug="yishu",
            title="徐克风格",
            usage="插画风 / 艺术字 / 艺术海报",
            body=f"{SOURCE_NOTE}\n\n**风格提示词**：\n{TSUI_HARK}",
            prompt_text=TSUI_HARK,
            tags=["古风", "电影感", "摄影"],
            medium="图像",
        )
    )

    items.append(
        item(
            id="yishu-45",
            category="艺术",
            category_slug="yishu",
            title="岩彩画风格",
            usage="插画风 / 艺术字 / 艺术海报",
            body=f"{SOURCE_NOTE}\n\n**提示词**：\n{YANCAI}",
            prompt_text=YANCAI,
            tags=["插画", "古风"],
            medium="图像",
        )
    )

    items.append(
        item(
            id="yishu-46",
            category="艺术",
            category_slug="yishu",
            title="指环王风格",
            usage="插画风 / 艺术字 / 艺术海报",
            body=f"{SOURCE_NOTE}\n\n**风格提示词**：\n{LOTR}",
            prompt_text=LOTR,
            tags=["电影感", "摄影", "写实"],
            medium="图像",
        )
    )

    items.append(
        item(
            id="yishu-47",
            category="艺术",
            category_slug="yishu",
            title="米山舞风格",
            usage="插画风 / 艺术字 / 艺术海报",
            body=f"{SOURCE_NOTE}\n\n{YONEYAMA}",
            prompt_text=YONEYAMA,
            tags=["插画", "二次元"],
            medium="图像",
        )
    )

    items.append(
        item(
            id="yishu-48",
            category="艺术",
            category_slug="yishu",
            title="真人光影风格",
            usage="插画风 / 艺术字 / 艺术海报",
            body=f"{SOURCE_NOTE}\n\n**风格提示词**：\n{LIVE_LIGHT}",
            prompt_text=LIVE_LIGHT,
            tags=["写实", "摄影", "人像", "电影感"],
            medium="图像",
        )
    )

    items.append(
        item(
            id="yishu-49",
            category="艺术",
            category_slug="yishu",
            title="朦胧真人风格",
            usage="插画风 / 艺术字 / 艺术海报",
            body=f"{SOURCE_NOTE}\n\n**风格提示词**：\n{SOFT_LIVE}",
            prompt_text=SOFT_LIVE,
            tags=["写实", "摄影", "人像", "电影感"],
            medium="图像",
        )
    )
    return items


# Imagine cover prompts: no official film/artist/studio names.
IMAGINE = {
    "changjing-9-01": (
        "16:9",
        "A single cinematic cover still. Classic 1960s-70s Hong Kong wuxia film look with vintage celluloid grain. "
        "A cyber-jianghu street vendetta: an adult swordsman stands facing forward in a busy old-town market, sharp gaze locked on someone just off-camera, "
        "a mechanical scabbard at his waist glowing faintly neon, robe hem stained with mud, holographic shop signs and passing pedestrians beside him, "
        "distant mechanical inspection insects flying past. High-angle medium shot. Warm street-fire light against a colder mood on the figure. "
        "About 30 percent cyber elements only (scabbard, holographic signs, inspection insects). Tense, grounded, no watermark, no text, no logos.",
    ),
    "changjing-9-02": (
        "16:9",
        "A single cinematic cover still. Classic 1960s-70s Hong Kong wuxia film look with vintage celluloid grain. "
        "High aerial follow-shot of a thousand-person jianghu parade down a long street, adult martial artists in unified dark athletic robes with subtle neon patterns, "
        "fluorescent swords and mechanical banners, red lanterns, holographic signs and cyber-neon ads lining both sides, an ancient bridge and a hovering patrol vehicle in the distance. "
        "Warm festive light, vast scale, about 30 percent cyber elements in clothing, flags and the patrol vehicle. No watermark, no text, no logos.",
    ),
    "changjing-9-03": (
        "16:9",
        "A single cinematic cover still. Classic Hong Kong wuxia cinema mixed with restrained cyberpunk. Cool palette of cyan, blue, black and muted gold. "
        "A ruined ancient battlefield and a colossal cyber city gate in heavy rain and fog. Low-angle wide epic shot. "
        "An adult cyber-armored warrior in a black cloak, dark-gold inlay, face half-veiled, holding a massive horizontal blade, riding a mechanical warhorse with mixed machine and living structure, "
        "hooves shattering electric light, cloak whipping, blade glowing cold. Hyper-detailed, photoreal, no watermark, no text, no logos.",
    ),
    "changjing-9-04": (
        "16:9",
        "A single cinematic cover still. Classic 1960s-70s Hong Kong wuxia film look with vintage celluloid grain and high contrast. "
        "High aerial panorama of a martial gathering: a thousand adult swordsmen in antique athletic robes with subtle neon patterns fill a bluestone plaza, "
        "a mechanical-etched duel platform at the center, giant neon banners and a holographic ranking list, rooftops wrapped in neon light-strips, "
        "hovering airships and mechanical insects in the distance. About 30 percent cyber elements. Grand, no watermark, no text, no logos.",
    ),
    "changjing-9-05": (
        "16:9",
        "A single cinematic cover still. Epic ultra-wide view of a colossal antique-cyber jianghu capital: thousand-year city walls crossed with floating mecha towers, "
        "upturned eaves hung with neon light strips, flying swords and airships in mist, ink-dark distant mountains. Photoreal 8K, no watermark, no text, no logos.",
    ),
    "changjing-9-06": (
        "16:9",
        "A single cinematic cover still. Rainy-night antique-cyber street, wet bluestone reflecting lights, oil-paper umbrellas beside holographic ads, "
        "red lanterns crossed with neon signs, mist in the air, dark cinematic mood, busy yet lonely jianghu atmosphere. No watermark, no text, no logos.",
    ),
    "changjing-9-07": (
        "16:9",
        "A single cinematic cover still. A white-jade rainbow bridge spans a sea of clouds, linking floating immortal isles, "
        "rolling cloud-waves and a river of starlight beneath, glowing array patterns inlaid in the bridge, celestial atmosphere fused with subtle technology. "
        "Epic, heaven-like, no watermark, no text, no logos.",
    ),
    "changjing-10-01": (
        "16:9",
        "A single cinematic cover still. Framing composition, ancient pine branches as foreground occlusion, "
        "grand hidden celestial palace behind mist, glowing palace lights leak through cloud gaps, full starry sky above, "
        "pool reflection at the bottom of the frame, real night outdoor photography, rich layering of light and shadow. "
        "No watermark, no typography, no logos.",
    ),
    "changjing-10-02": (
        "16:9",
        "A single cinematic cover still. Vertical top-down shot, a single grand heavenly palace stands on an isolated giant cloud island, "
        "surrounded by a boundless rolling cloud sea, small water pools around the palace courtyard, a distant faint nebula in the night sky, "
        "warm golden lamplight from palace windows, photorealistic atmospheric perspective. No watermark, no typography, no logos.",
    ),
    "changjing-10-03": (
        "16:9",
        "A single cinematic cover still. Ultra realistic landscape photography, grand floating ancient Chinese celestial palace clusters, "
        "blue glazed tile roofs with golden decorative carvings, warm lantern lights shining from doors and windows, vast starry night sky, flowing milky way, "
        "thick rolling clouds wrap around building bases, a quiet pond in the foreground with a complete palace reflection on calm water, "
        "deep indigo color grading, natural night atmosphere, cinematic ambient occlusion, 8k high detail. No watermark, no typography, no logos.",
    ),
    "changjing-10-04": (
        "16:9",
        "A single cinematic cover still. Top-down aerial overhead shot, grand clustered ancient Chinese celestial palaces, "
        "blue glazed tile roofs carved with golden dragon patterns, elaborate dougong and upturned eaves, numerous floating cloud islands connected by carved jade arch bridges, "
        "winding mist lingering in valley gaps between clouds, a tranquil lake reflecting twinkling stars and palace outlines, "
        "boundless starry sky with glowing milky way and faint nebula, warm golden lamplight spilling from palace doors and windows. "
        "No watermark, no typography, no logos.",
    ),
    "changjing-11": (
        "16:9",
        "A single cinematic cover still. Subject: a half-suspended ancient celestial city in a calm sea of clouds, thousands of warm lamps in the palaces, "
        "a waterfall of starlight hanging from the night sky, long corridors with faint walking silhouettes, magnificent yet emotionally cold, a gorgeous loneliness. "
        "Photoreal cinematic night landscape, no watermark, no typography, no logos.",
    ),
    "renwu-29": (
        "3:4",
        "A single tasteful cover portrait of an adult East Asian woman in antique jianghu clothing, fully clothed, clearly adult facial structure. "
        "Lazy, detached, slightly sly closed-lip expression. Soft spring rim light with gentle god-rays, shallow depth of field, every hair strand visible, "
        "luminous skin, slight low-angle close-up. She holds an oil-paper umbrella, windswept hair, sparkling eyes, cool yet alluring poise, "
        "blue sky background, faint cyan camera grain, bright airy look. No identity copy of any real person, no watermark, no text.",
    ),
    "renwu-30": (
        "9:16",
        "A single tasteful cover portrait, 9:16, of an adult woman, clearly adult, fully clothed, shoulder-up close-up. "
        "She shows the right half of her face and a hand gesture, sweet lazy mood, slightly lowered eyes, lashes half hidden by hair, soft gaze. "
        "Naturally fluffy white hair with loose strands on the cheek and forehead, hair edges glowing in cool-white side-backlight from the right, "
        "soft contrast, beige plain wall background slightly defocused, heavy soft-focus, Kodak Gold 200-like warm film, slight overexposure, "
        "lens haze, shallow depth of field, intimate afternoon snapshot feeling. Original character, no identity copy of any real person, no watermark, no text.",
    ),
    "renwu-31": (
        "3:4",
        "A single still from a naturalistic live-action close-up of an adult woman, fully clothed, quiet and restrained. "
        "Soft daylight, she looks slightly to the right of camera, eyes gently moist, lips parted as if about to speak, a tender slightly melancholy expression, "
        "no tears, no crying, photoreal skin, film grain, cinematic but intimate. No watermark, no text.",
    ),
    "texiao-2": (
        "3:4",
        "A single epic still, high-quality anime key-visual style. An adult xianxia woman in a flowing cyan immortal dress floats in the sky, arms thrown wide, "
        "behind her a colossal semi-transparent golden goddess dharma-form thousands of zhang tall rises and blots out the sun, "
        "golden energy shockwave, ancient golden runes and lightning around the apparition, extreme scale contrast, sacred and overwhelming. "
        "Original character, no watermark, no typography, no logos.",
    ),
    "yishu-43": (
        "3:4",
        "A single cinematic cover still. Subject: an adult swordsman standing alone on an empty mountain road, wind moving the robe and distant grasses. "
        "Shot as 35mm coarse-grain film with a physical-development look, earth tones and pale cyan, austere, cold, and severe. "
        "Side-backlight, high contrast, smoke scatter, strong light shaping the shadow edge. Foreground occlusion, sparse composition, negative space, natural wind motion. "
        "Heavy yet restrained tonal layers. No watermark, no text, no logos.",
    ),
    "yishu-44": (
        "16:9",
        "A single cinematic cover still. Subject: an adult swordsman holding a blade, facing upward. "
        "14mm ultra-wide extreme low-angle shot, tilted off-balance composition. Bleached, overexposed wasteland color grading, fierce backlight with blown highlights, "
        "film grain and motion blur. Dramatic, kinetic, no watermark, no text, no logos.",
    ),
    "yishu-45": (
        "3:4",
        "A single cover still in mineral-pigment rock-color painting. Subject: a rock-carved divine maiden. "
        "Cyan-blue dyes softened by time and wrinkled by wind-sand, gold-leaf fragments catching light like a rolling wave. "
        "As if wind were passing through a cave and moonlight entering the painting, gold pigment flowing in the light. Painterly, no watermark, no typography, no logos.",
    ),
    "yishu-46": (
        "16:9",
        "A single cinematic cover still. Subject: a small group of adult travelers on a ridge path beneath vast misty mountains. "
        "Overcast soft light, a little thin fog, cold grey-green epic palette, low saturation, highlights pulled down, greens shifted toward grey olive. "
        "Theatrical 8K live-action photography look, 35mm film grain, gentle natural light, shallow atmospheric haze, physical sets and real props feeling, no famous copyrighted characters, no official titles, no watermark, no text, no logos.",
    ),
    "yishu-47": (
        "3:4",
        "A single high-finish digital anime illustration cover. Subject: an original adult woman character, not resembling any known copyrighted character. "
        "Refined cel-shaded flats with soft gradients, local thick-paint accents, transparent overlays and graphic decoration. "
        "Fluid, elongated, curve-driven forms with clear structure, varied line weight, color-tinted shadows rather than grey, high-purity primaries against low-purity transitions, "
        "cool-warm shifts of cyan, violet, pink, orange and teal, luminous iridescent highlights and slight chromatic fringe, "
        "abstract fluid, crystal, shard and ripple ornaments as visual rhythm only, mild paper grain and print misregistration, "
        "bright, ornate, dreamlike, slightly experimental graphic design. No watermark, no typography, no logos, no artist signature.",
    ),
    "yishu-48": (
        "3:4",
        "A single cinematic cover still. Subject: an adult person standing by an indoor window in quiet daylight. "
        "True photography, not CG, not anime. Real skin detail: pores, nasolabial softness, lip texture, matte skin, natural blood color, real hair strands. "
        "Slight film grain, anamorphic lens flare, low-saturation warm neutral grade, lifted blacks, rich midtones, bright but unclipped window highlights. "
        "Large soft daylight from the side or side-back, almost no frontal fill, soft shadow edges, no stage spotlight, no hard rim light. "
        "Matte or semi-matte fabrics, wood, porcelain and glass, medium-soft sharpness, low contrast, intimate lived-in film mood. No watermark, no text.",
    ),
    "yishu-49": (
        "3:4",
        "A single cinematic cover still. Subject: an adult person in a quiet everyday indoor moment, perhaps by a window, with soft foreground objects. "
        "Naturalistic live-action film, calm, gentle, restrained. Low-saturation warm neutrals: ivory, cream, light grey, khaki, warm wood, muted blue-grey, pale sage. "
        "Lifted blacks, rich midtones, bright unclipped highlights. Large soft daylight from the side or side-back, almost no frontal fill. "
        "Eye-level or slightly low, medium to medium-close, 35-50mm full-frame feel, moderate depth of field, subject sharp, foreground and distance softly blurred. "
        "Matte natural materials, slightly soft sharpness, faint film grain, intimate and unhurried. No watermark, no text.",
    ),
}


def new_items() -> list[dict]:
    return build_items()


def merge_items(existing: list[dict]) -> tuple[list[dict], list[dict]]:
    incoming = build_items()
    by_id = {it["id"]: i for i, it in enumerate(existing)}
    added = []
    replaced = []
    for it in incoming:
        if it["id"] in by_id:
            # Refresh text but keep already-curated media and bilingual prompts.
            old = existing[by_id[it["id"]]]
            if old.get("cover"):
                it["cover"] = old["cover"]
            if isinstance(old.get("covers"), list) and old["covers"]:
                it["covers"] = old["covers"]
            if old.get("chinesePrompt"):
                it["chinesePrompt"] = old["chinesePrompt"]
            if old.get("grokPrompt"):
                it["grokPrompt"] = old["grokPrompt"]
            existing[by_id[it["id"]]] = it
            replaced.append(it)
        else:
            existing.append(it)
            added.append(it)
    return existing, added, replaced


def write_batch(items: list[dict]) -> None:
    payload = {
        "batch": "obsidian-20261120",
        "count": len(items),
        "items": [],
    }
    for it in items:
        aspect, prompt = IMAGINE[it["id"]]
        payload["items"].append(
            {
                "id": it["id"],
                "title": it["title"],
                "imagineAspect": aspect,
                "imaginePrompt": prompt,
                "outfile": str(INBOX / f"{it['id']}.jpg"),
                "final": f"public/covers/entries/{it['id']}.jpg",
                "flags": [],
            }
        )
    BATCH.parent.mkdir(parents=True, exist_ok=True)
    BATCH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def update_progress(ids: list[str]) -> None:
    progress = {
        "completed": [],
        "failed": [],
        "pending": [],
    }
    if PROGRESS.exists():
        progress = json.loads(PROGRESS.read_text(encoding="utf-8"))
    completed = list(progress.get("completed") or [])
    failed = list(progress.get("failed") or [])
    pending = list(progress.get("pending") or [])
    for i in ids:
        if i not in completed and i not in pending:
            pending.append(i)
        if i in failed:
            # new attempt
            failed = [x for x in failed if x != i]
    progress["completed"] = completed
    progress["failed"] = failed
    progress["pending"] = pending
    PROGRESS.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def hook_parse_prompts() -> None:
    """Ensure future `npm run parse` re-applies this supplement and does not drop IDs."""
    path = ROOT / "scripts" / "parse_prompts.py"
    text = path.read_text(encoding="utf-8")
    changed = False
    if '"changjing-9"' not in text:
        text = text.replace(
            '"changjing-4": "未来景观",\n}',
            '"changjing-4": "未来景观",\n    "changjing-9": "邵氏赛博",\n    "changjing-10": "仙侠繁华试",\n}',
        )
        changed = True
    hook = (
        "    # Keep the Obsidian 2026-11-20 supplement after a master re-parse.\n"
        "    from merge_obsidian_styles import apply_to_payload\n"
        "    payload, meta = apply_to_payload(payload, meta)\n"
        "    items = payload[\"items\"]\n"
    )
    if "merge_obsidian_styles import apply_to_payload" not in text:
        needle = "    os.makedirs(os.path.dirname(OUT), exist_ok=True)\n"
        if needle not in text:
            raise SystemExit("parse_prompts.py hook point not found")
        text = text.replace(needle, hook + "\n" + needle, 1)
        changed = True
    if changed:
        path.write_text(text, encoding="utf-8")
        print("updated parse_prompts.py hook")
    else:
        print("parse_prompts.py already hooked")


def apply_to_payload(payload: dict, meta: dict | None = None) -> tuple[dict, dict]:
    items, added, replaced = merge_items(list(payload["items"]))
    generated = payload.get("generatedFrom") or "PROMPT_MASTER.md"
    if SOURCE not in str(generated):
        generated = f"{generated} + {SOURCE}"
    master_count = payload.get("masterCount") or 106
    meta = build_meta(items, generated, master_count)
    payload = dict(payload)
    payload.update(
        {
            "generatedFrom": generated,
            "masterCount": master_count,
            "count": len(items),
            "categories": meta["categories"],
            "collections": meta["collections"],
            "tagFacets": meta["tagFacets"],
            "items": items,
        }
    )
    payload["_mergeAdded"] = [it["id"] for it in added]
    payload["_mergeReplaced"] = [it["id"] for it in replaced]
    return payload, meta


def main() -> None:
    data = json.loads(PROMPTS.read_text(encoding="utf-8"))
    payload, meta = apply_to_payload(data)
    added = payload.pop("_mergeAdded")
    replaced = payload.pop("_mergeReplaced")
    PROMPTS.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    all_new = build_items()
    write_batch(all_new)
    update_progress([it["id"] for it in all_new])
    hook_parse_prompts()
    print(f"items now: {payload['count']}")
    print(f"added: {added}")
    print(f"replaced: {replaced}")
    print(f"categories: {payload['categories']}")
    print(f"wrote {BATCH}")
    # sanity
    ids = [it["id"] for it in payload["items"]]
    assert len(ids) == len(set(ids)), "duplicate ids"
    for it in all_new:
        assert it["id"] in IMAGINE, it["id"]
        assert len(it["tags"]) <= 8, (it["id"], it["tags"])
        assert it["promptText"], it["id"]


if __name__ == "__main__":
    main()
