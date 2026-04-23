# 步骤5 手机发布 API（`/api/phone-publish`）

与 `douyin_publish`（服务端 Chromium）独立。详见仓库根目录 `神将必看.md` 中「步骤5」与 adb 说明。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/phone-publish/abort` | 请求终止步骤5 同步任务：置取消标记 + **adb `am force-stop` 抖音包**（优先当前设备，否则全部已连接 device）；协作式检查点仍保留 |
| GET | `/api/phone-publish/health` | adb 是否可用 |
| GET | `/api/phone-publish/devices` | `adb devices -l`，仅 `state=device` |
| POST | `/api/phone-publish/scan-douyin` | body `{"serials":[]}`；空串表示当前全部 `device`。**uiautomator2**：唤醒屏幕 → 先 **force-stop** 再 **冷启动** 抖音 → 轮询前台包名为抖音即 `account_label=已打开抖音`（需 `pip install uiautomator2`）。返回 `accounts[]` 仍含 `douyin_id`/`nickname`（现多为空）、失败时 `scan_error` |
| POST | `/api/phone-publish/poc-publish-entry` | 步骤5 POC：**先强制停止抖音再冷启动** →「+」→「相册」（`results[]` 含 `ok`/`message`）；不选片、不发布 |
| POST | `/api/phone-publish/publish-on-device` | body 含 `device_serial`、`video_url`、`hashtags`、`topic_caption`（可选，非空时优先写入「#话题」框，如 `横幅#词1#词2#词3#词4#词5`）、`dry_run`、`skip_caption_fill`：`adb push` → **抖音先 force-stop 再冷启动** → 选片后两次「下一步」→ 点 #话题 → 粘贴 → 发布；`skip_caption_fill` 默认 **true**；`dry_run=true` 不点「发作品」 |
| POST | `/api/phone-publish/publish` | body `{"items":[{"video_url","device_serial","account_ref","description","hashtags"}]}`：仅服务端校验成片路径（占位） |

环境变量 / 配置：`PHONE_PUBLISH_ENABLED`、`PHONE_PUBLISH_ADB_PATH`、`PHONE_PUBLISH_DOUYIN_PACKAGE`、`PHONE_PUBLISH_UI_SCAN_TIMEOUT_S`、`PHONE_PUBLISH_FLOW_TIMEOUT_S`（全流程，默认 120，见 `app/settings.py`）。扫描抖音见 `douyin_ui_scan.py`；手机端完整发布见 `douyin_publish_flow.py`、`phone_media_push.py`。

---

## 首开慢与相册选片（原理、代码对应与外部参考）

### 为什么第一次冷启动后，点「+」前要等很久？

- **抖音冷启动**：Splash、协议挡板、底栏未就绪等，需 [`_wait_until_main_visible`](../app/phone_publish/douyin_ui_scan.py) 轮询「推荐/首页」等特征；USB 慢时单次 `exists` 也会变长。
- **点「+」**：[`_click_plus_open_sheet`](../app/phone_publish/douyin_publish_poc.py) 用底栏坐标试探 + `ok_sheet()` 检测「相册」等；为避免首开时全量 `dump_hierarchy()`（真机可达 10s+），前若干次仅走快路径，可能多轮 tap 才成功，体感偏慢。
- **不可完全消除**：部分时间在 App 自身冷启动，自动化只能减少**无效固定睡眠**与**误判重试**，不能「加速抖音进程」。

### 为什么「相册里指定视频」不能假设永远在左上角？

- **排序依据**：系统 / 抖音内嵌相册多按 **MediaStore 添加时间、修改时间或 App 内部排序**；同一服务器文件再次 push、或媒体库未把新条目排在最前时，**不一定在首格**。
- **工程策略**：成片 push 为唯一文件名 `douyin_publish_<serial>_<rand>.mp4`，[`phone_media_push.py`](../app/phone_publish/phone_media_push.py) 在推送前 `rm` 旧 `douyin_publish_*`，**push 成功后对设备端文件执行 `adb shell touch`**，将 mtime 对齐为手机「当前时间」，减轻宿主机历史 mtime 导致排序靠后；选片在 [`_tap_grid_pick_pushed_video`](../app/phone_publish/douyin_publish_flow.py) 中优先切 **「视频」Tab**、**无障碍匹配 `douyin_publish`**，少量 attempt + 固定网格比例兜底（**不做相册内大范围 fling**，避免误触关闭）；[`_wait_until_main_visible`](../app/phone_publish/douyin_ui_scan.py) 除「推荐/首页」外兼容 **「朋友」「我」及 description 含「发布」** 等底栏特征。
- **冷启动参数（`publish-on-device`）**：等主界面窗口上限约 **15s**（与 `deadline` 取 min）；进首页后 **约 1.5s 静息**再点「+」；等首页循环内会尝试点 **含「跳过」** 的开屏控件，lite 挡板亦优先「跳过」类文案。

### 建议阅读（权威 / 社区）

| 主题 | 链接 |
|------|------|
| UI Automator 与显式等待思路 | [Android Developers: UI Automator](https://developer.android.com/training/testing/other-components/ui-automator) |
| uiautomator2 Python API | [uiautomator2 文档](https://uiautomator2.readthedocs.io/en/latest/api.html) |
| 测试时向相册注入媒体与 DISPLAY_NAME | [Medium: Provide photos to gallery for UI tests](https://medium.com/@h2osolid/android-how-to-provide-photos-to-the-gallery-for-running-ui-automated-tests-37a232c066d) |
| 图库自动化常见坑 | [StackOverflow: UIAutomator and Android Image Gallery](https://stackoverflow.com/questions/44613106/uiautomator-and-android-image-gallery) |
