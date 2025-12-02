# Xiaoheihe Comment Exporter

一个用于“小黑盒”网页端的 Chrome 扩展：自动抓取帖子内全部评论导出为 CSV，并在本地分析页生成词云、评论榜单与地域分布图。

## 功能
- 一键抓取帖子所有评论（自动展开“查看更多/更多回复”、滚动加载）。
- 导出 CSV（字段：index、comment_id、parent_id、user、ip、content、likes），文件名示例 `post_123456_comments.csv`。
- 下载完成自动打开分析页面，展示：
  - 词云（中心最大词、黑白极简风、悬停提示/点击高亮可重置）。
  - 评论概览、Top 用户、Top 点赞。
  - 地域分布径向“花瓣”图（灰阶深浅代表占比，悬停/点击高亮）。
- 可手动上传任意符合字段的 CSV 重复分析。

## 安装（开发者模式）
1) 打开 Chrome 访问 `chrome://extensions/`。  
2) 右上角开启 **开发者模式**。  
3) 点击 **加载已解压的扩展程序**，选择本项目根目录（含 `manifest.json` 的文件夹）。  
4) 工具栏会出现 **Xiaoheihe Comment Exporter** 图标。

## 使用
### 自动导出并分析
1) 登录“小黑盒”并打开任意帖子详情页。  
2) 点击工具栏图标，或页面右侧浮动的“导出评论为 CSV”按钮。  
3) 等待提示完成：浏览器会自动下载 CSV 并打开分析页；词云、榜单、地域图会自动渲染。  

### 手动导入 CSV 分析
1) 打开 `analyzer.html`（扩展会自动打开，也可手动在浏览器输入地址或双击本地文件）。  
2) 点击“选择 CSV 文件”并选择你的 CSV，随后点击“开始分析”。  

## CSV 字段说明
- header 必须包含：`index,comment_id,parent_id,user,ip,content,likes`（顺序可变）。  
- 其中 `user`/`ip` 至少有一个，`content` 不为空才能参与分析。  

## 项目结构
- `content.js`：注入到帖子页，负责抓取/导出 CSV。  
- `background.js`：负责打开分析页并传递 CSV 数据。  
- `analyzer.html` / `analyzer.js`：本地分析页面（词云、榜单、地域花瓣图）。  
- `manifest.json`：Chrome 扩展清单。  

## 注意事项
- 抓取基于 DOM 选择器和文字特征，若站点改版可调整 `content.js` 中的选择器和展开逻辑。  
- 抓取时请保持页面加载完成并登录；如评论较多，需等待自动滚动与“查看更多”点击结束。  
- 本扩展不调用私有接口，仅读取当前页面可见内容。  

## 开发
- 本项目为纯前端，无构建步骤，修改后可直接在 `chrome://extensions/` 中点击“重新加载”。   
