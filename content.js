(() => {
  if (window.__xhhCommentExporterInjected) return;
  window.__xhhCommentExporterInjected = true;

  const BUTTON_ID = "xhh-export-comments-btn";
  const TOAST_ID = "xhh-export-toast";
  const PROGRESS_ID = "xhh-export-progress";
  let running = false;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const isPostPage = () => {
    const path = location.pathname || "";
    const looksLikePost =
      /bbs|community|post|article|topic/i.test(path) || /\d{5,}/.test(path);
    const hasPostMarker = !!document.querySelector("[data-post-id]");
    return looksLikePost || hasPostMarker;
  };

  const normalizeText = (value) => (value || "").replace(/\s+/g, " ").trim();

  const pickText = (root, selectors) => {
    for (const sel of selectors) {
      const node = root.querySelector(sel);
      if (node) {
        const txt = normalizeText(node.textContent || "");
        if (txt) return txt;
      }
    }
    return "";
  };

  const parseLikes = (value) => {
    const match = (value || "").match(/-?\d+/);
    if (!match) return "";
    const num = Number(match[0]);
    return Number.isFinite(num) ? num : "";
  };

  const findCommentElements = () => {
    // Prefer direct content containers to avoid nesting replies inside parents.
    const selectors = [
      ".comment-item__content",
      ".link-comment__comment-children .comment-item__content",
      "[data-comment-id]",
      "[data-reply-id]",
      "[data-id]",
      ".comment-item",
      ".comment-item-box",
      ".bbs-comment-item",
      ".post-comment",
      ".link-comment-item",
      ".reply-item",
      ".reply",
      "[class*=comment-item]",
      "[class*=CommentItem]",
      "[class*=commentCard]",
      "[class*=commentRow]",
      "[class*=replyItem]"
    ];
    const results = new Set();
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((node) => results.add(node));
    });

    // Fuzzy catch-all: elements whose class names contain "comment" and look like items.
    Array.from(
      document.querySelectorAll("[class*='comment'], [class*='Comment']")
    ).forEach((node) => {
      const cls = (node.className || "").toString().toLowerCase();
      if (cls.includes("list") || cls.includes("wrap") || cls.includes("container")) return;
      const hasUser = node.querySelector(
        "[class*=author], [class*=user], [class*=nickname], .nickname, .name, .user-name"
      );
      const hasContent = node.querySelector(
        "[class*=content], [class*=text], .comment-text, .richtext, p"
      );
      if (hasContent || hasUser) results.add(node);
    });

    return Array.from(results);
  };

  const BAD_CONTENT_CLASSES = [
    "immersive-translate",
    "translate-input",
    "ads",
    "toast",
    "level-tag",
    "info-box__create-time",
    "info-box__ip"
  ];
  const BAD_CONTENT_PATTERNS = [
    /position:\s*absolute/i,
    /z-index:\s*\d{4,}/i,
    /display:\s*flex/i
  ];

  const isNoiseNode = (node) => {
    const cls = (node.className || "").toString().toLowerCase();
    return BAD_CONTENT_CLASSES.some((bad) => cls.includes(bad));
  };

  const pickContentNode = (root) => {
    const candidates = Array.from(
      root.querySelectorAll(
        "[class*=content], [class*=text], .comment-text, .richtext, p, blockquote"
      )
    ).filter((node) => !isNoiseNode(node));

    if (!candidates.length) return null;

    // Prefer the deepest node with meaningful text.
    const scored = candidates
      .map((node) => {
        const txt = normalizeText(node.innerText || node.textContent || "");
        return { node, len: txt.length, txt, depth: getDepth(node) };
      })
      .filter((item) => item.len > 0);

    if (!scored.length) return null;

    scored.sort((a, b) => {
      // Prefer longer text, then deeper nodes.
      if (b.len !== a.len) return b.len - a.len;
      return b.depth - a.depth;
    });
    return scored[0].node;
  };

  const getDepth = (node) => {
    let depth = 0;
    let current = node;
    while (current && current !== document.body) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  };

  const sanitizeContent = (text) => {
    const trimmed = normalizeText(text);
    if (!trimmed) return "";
    if (BAD_CONTENT_PATTERNS.some((re) => re.test(trimmed))) return "";
    if (/^\d+$/.test(trimmed)) return "";
    if (/^[@#]/.test(trimmed) && trimmed.length < 4) return "";
    // Avoid extremely long blobs that are likely non-comment content.
    if (trimmed.length > 2000) return trimmed.slice(0, 2000);
    return trimmed;
  };

  const cleanContent = (raw, user) => {
    if (!raw) return "";
    let text = raw;
    // Strip "作者 :" 前缀
    text = text.replace(/^\s*[\w\.\-\u4e00-\u9fa5]+\s*作者\s*:\s*/i, "");
    // 去掉“XXX回复 YYY:”元信息
    if (/^\s*\S+\s*回复\s+\S+\s*:/i.test(text) && text.length < 80) {
      return "";
    }
    text = text.replace(/\s+\S+\s*回复\s+\S+\s*:\s*.*$/i, "");
    // 去掉时间/IP尾巴，例如 “4天前 ·江苏”
    text = text.replace(/\s+\d+\s*(天前|小时前|分钟前)\s*·?\s*[\u4e00-\u9fa5A-Za-z0-9._-]*\s*$/i, "");
    text = text.replace(/\s*(刚刚|昨天|前天)\s*·?\s*[\u4e00-\u9fa5A-Za-z0-9._-]*\s*$/i, "");
    text = text.replace(/\s*·\s*[\u4e00-\u9fa5A-Za-z0-9._-]+\s*$/i, "");
    // 去掉前缀用户名重复
    if (user && text.startsWith(user)) {
      text = text.slice(user.length).trim();
    }
    // 去掉等级标识，如 Lv.19 / Lv 19 / level-19 / 等级19
    text = text.replace(/\bLv\.?\s*\d+\b/gi, "");
    text = text.replace(/\blevel[-\s]*\d+\b/gi, "");
    text = text.replace(/等级\s*\d+/gi, "");
    return text.trim();
  };

  const extractComment = (element, index) => {
    const commentId =
      element.getAttribute("data-comment-id") ||
      element.getAttribute("data-id") ||
      element.getAttribute("data-key") ||
      element.id ||
      "";
    const parentId =
      element.getAttribute("data-parent-id") ||
      element.getAttribute("data-reply-id") ||
      "";

    // Work on a clone so we can strip nested replies and metadata.
    const working = element.cloneNode(true);
    working
      .querySelectorAll(
        ".link-comment__comment-children, [class*=comment-children], .level-tag__wrapper, [class*=level-tag], .comment-item__tag-line, [class*=tag-line]"
      )
      .forEach((node) => node.remove());
    // Strip info boxes after reading IP.
    const ip = pickText(element, [".info-box__ip", "[class*=ip]"]);
    working
      .querySelectorAll(
        ".info-box, [class*=info-box], .info-box__create-time, .info-box__ip"
      )
      .forEach((node) => node.remove());

    let user = pickText(element, [
      "[class*=author]",
      "[class*=user]",
      "[class*=nickname]",
      ".nickname",
      ".name",
      ".user-name"
    ]);
    if (!user) {
      const anchor = element.querySelector("a");
      user = normalizeText(anchor ? anchor.textContent || "" : "");
    }
    // Remove level suffix like "Lv.18".
    user = user.replace(/\bLv\.?\s*\d+\b/gi, "").trim();

    let content = "";
    const contentNode = pickContentNode(working);
    if (contentNode) {
      content = sanitizeContent(contentNode.innerText || contentNode.textContent || "");
    }
    if (!content) {
      content = sanitizeContent(working.innerText || working.textContent || "");
    }
    content = sanitizeContent(cleanContent(content, user));
    // Drop content lines that are actually metadata (user + Lv. + time/ip).
    if (content && user && content.includes(user) && /Lv\.?\s*\d+/i.test(content)) {
      content = "";
    }

    const likesText = pickText(element, [
      "[class*=like]",
      ".like",
      ".digg",
      ".thumb"
    ]);
    const likes = parseLikes(likesText);

    return {
      index: index + 1,
      comment_id: commentId,
      parent_id: parentId,
      user,
      ip,
      content,
      likes
    };
  };

  const clickExpandableElements = async (maxPasses = 12) => {
    const keywordMatches = (node) => {
      const text = (node.textContent || "").toLowerCase();
      return (
        text.includes("more") ||
        text.includes("load") ||
        text.includes("查看更多") ||
        text.includes("更多评论") ||
        text.includes("展开评论") ||
        text.includes("展开更多") ||
        text.includes("展开回复") ||
        text.includes("更多回复") ||
        text.includes("展开") ||
        text.includes("更多")
      );
    };

    for (let pass = 0; pass < maxPasses; pass += 1) {
      const clickable = Array.from(
        document.querySelectorAll("button, a, div, span")
      ).filter((node) => {
        if (node.getAttribute("aria-disabled") === "true") return false;
        const cls = (node.className || "").toString().toLowerCase();
        return (
          keywordMatches(node) ||
          cls.includes("more") ||
          cls.includes("expand") ||
          cls.includes("load")
        );
      });
      if (!clickable.length) break;
      clickable.forEach((node) => node.click());
      await sleep(800);
    }
  };

  const clickLoadMoreButtons = async () => {
    const buttons = Array.from(
      document.querySelectorAll("button, a, div")
    ).filter((node) => {
      const text = (node.textContent || "").trim();
      if (!text) return false;
      const lower = text.toLowerCase();
      return (
        lower.includes("查看更多") ||
        lower.includes("更多评论") ||
        lower.includes("更多回复") ||
        lower.includes("加载更多") ||
        lower.includes("load more") ||
        lower.includes("more comments") ||
        lower.includes("more replies")
      );
    });
    buttons.forEach((btn) => btn.click());
    if (buttons.length) await sleep(900);
    return buttons.length;
  };

  const openCommentSection = async () => {
    const triggers = Array.from(
      document.querySelectorAll("button, a, div, span")
    ).filter((node) => {
      const text = normalizeText(node.textContent || "").toLowerCase();
      if (!text) return false;
      return (
        text.includes("评论") ||
        text.includes("讨论") ||
        text.includes("查看评论") ||
        text.includes("参与讨论") ||
        text.includes("全部评论")
      );
    });
    triggers.forEach((el) => el.click());
    if (triggers.length) {
      await sleep(600);
    }
  };

  const scrollToLoad = async (maxRounds = 24) => {
    let lastHeight = document.documentElement.scrollHeight;
    let stableCount = 0;

    for (let i = 0; i < maxRounds; i += 1) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      await sleep(900);
      const currentHeight = document.documentElement.scrollHeight;
      if (Math.abs(currentHeight - lastHeight) < 32) {
        stableCount += 1;
      } else {
        stableCount = 0;
      }
      lastHeight = currentHeight;
      if (stableCount >= 2) break;
    }
  };

  const loadAllComments = async () => {
    let lastCount = 0;
    let stableRounds = 0;
    for (let i = 0; i < 20; i += 1) {
      showProgress(Math.min(80, (i / 20) * 80 + 5), "正在加载更多评论...");
      await openCommentSection();
      await clickLoadMoreButtons();
      await clickExpandableElements();
      await scrollToLoad();

      const currentCount = findCommentElements().length;
      if (currentCount <= lastCount + 1) {
        stableRounds += 1;
      } else {
        stableRounds = 0;
      }
      lastCount = currentCount;
      if (stableRounds >= 2) break;
    }
    showProgress(90, "收尾整理中...");
  };

  const csvEscape = (value) => {
    const str = String(value ?? "");
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const toCsv = (rows) => {
    const headers = ["index", "comment_id", "parent_id", "user", "ip", "content", "likes"];
    const lines = [headers.join(",")];
    rows.forEach((row) => {
      lines.push(headers.map((key) => csvEscape(row[key] || "")).join(","));
    });
    return lines.join("\n");
  };

  const downloadCsv = (csv, filename) => {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const showToast = (message, type = "info") => {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.style.position = "fixed";
      toast.style.zIndex = "2147483647";
      toast.style.right = "20px";
      toast.style.bottom = "20px";
      toast.style.padding = "12px 16px";
      toast.style.borderRadius = "12px";
      toast.style.fontSize = "13px";
      toast.style.fontFamily = "Helvetica, Arial, sans-serif";
      toast.style.boxShadow = "0 12px 28px rgba(0,0,0,0.12)";
      toast.style.border = "1px solid #e5e7eb";
      toast.style.background = "#ffffff";
      toast.style.color = "#111827";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.background = "#ffffff";
    toast.style.borderColor = type === "error" ? "#fca5a5" : "#e5e7eb";
    toast.style.color = type === "error" ? "#b91c1c" : "#111827";
    toast.style.opacity = "1";
    setTimeout(() => {
      toast.style.opacity = "0";
    }, 2500);
  };

  const ensureButton = () => {
    if (!isPostPage()) return;
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.textContent = "导出评论为 CSV";
    btn.style.position = "fixed";
    btn.style.zIndex = "2147483647";
    btn.style.right = "24px";
    btn.style.top = "120px";
    btn.style.padding = "12px 18px";
    btn.style.border = "1px solid #e5e7eb";
    btn.style.borderRadius = "14px";
    btn.style.background = "linear-gradient(180deg, #ffffff, #f4f5f7)";
    btn.style.color = "#1f2937";
    btn.style.fontSize = "13px";
    btn.style.fontWeight = "600";
    btn.style.cursor = "pointer";
    btn.style.fontFamily = "Helvetica, Arial, sans-serif";
    btn.style.boxShadow = "0 12px 30px rgba(0,0,0,0.08)";
    btn.style.transition = "transform 0.2s ease, box-shadow 0.2s ease";
    btn.onmouseenter = () => {
      btn.style.transform = "translateY(-1px)";
      btn.style.boxShadow = "0 16px 34px rgba(0,0,0,0.12)";
    };
    btn.onmouseleave = () => {
      btn.style.transform = "translateY(0)";
      btn.style.boxShadow = "0 12px 30px rgba(0,0,0,0.08)";
    };
    btn.addEventListener("click", () => runExport({ trigger: "button" }));
    document.body.appendChild(btn);
  };

  const showProgress = (percent = 0, text = "正在抓取评论...") => {
    let wrap = document.getElementById(PROGRESS_ID);
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = PROGRESS_ID;
      wrap.style.position = "fixed";
      wrap.style.zIndex = "2147483646";
      wrap.style.left = "50%";
      wrap.style.top = "18px";
      wrap.style.transform = "translateX(-50%)";
      wrap.style.minWidth = "260px";
      wrap.style.maxWidth = "340px";
      wrap.style.padding = "12px 16px";
      wrap.style.background = "#ffffff";
      wrap.style.color = "#111827";
      wrap.style.borderRadius = "14px";
      wrap.style.border = "1px solid #e5e7eb";
      wrap.style.boxShadow = "0 16px 36px rgba(0,0,0,0.12)";
      wrap.style.fontFamily = "Helvetica, Arial, sans-serif";

      const title = document.createElement("div");
      title.id = `${PROGRESS_ID}-title`;
      title.style.fontSize = "13px";
      title.style.fontWeight = "600";
      title.style.marginBottom = "10px";
      wrap.appendChild(title);

      const bar = document.createElement("div");
      bar.style.width = "100%";
      bar.style.height = "8px";
      bar.style.background = "#f3f4f6";
      bar.style.borderRadius = "999px";
      bar.style.overflow = "hidden";

      const fill = document.createElement("div");
      fill.id = `${PROGRESS_ID}-fill`;
      fill.style.height = "100%";
      fill.style.width = "0%";
      fill.style.background = "linear-gradient(135deg, #d1d5db, #9ca3af)";
      fill.style.transition = "width 0.25s ease";
      bar.appendChild(fill);

      wrap.appendChild(bar);
      document.body.appendChild(wrap);
    }
    const title = document.getElementById(`${PROGRESS_ID}-title`);
    const fill = document.getElementById(`${PROGRESS_ID}-fill`);
    if (title) title.textContent = text;
    if (fill) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  };

  const hideProgress = () => {
    const wrap = document.getElementById(PROGRESS_ID);
    if (wrap) {
      wrap.remove();
    }
  };

  const runExport = async ({ trigger }) => {
    if (running) {
      showToast("导出进行中，请稍候...");
      return;
    }

    if (!isPostPage()) {
      showToast("当前页面不是帖子详情页。", "error");
      return;
    }

    running = true;
    showToast("开始抓取评论...");
    showProgress(5, "初始化...");

    await loadAllComments();
    showProgress(92, "正在整理 CSV...");

    const commentNodes = findCommentElements();
    const comments = commentNodes
      .map((node, idx) => extractComment(node, idx))
      .filter((item) => (item.user || item.ip) && item.content);

    // Deduplicate by (user, content) to reduce repeated captures from nested nodes.
    const seenIds = new Set();
    const seen = new Set();
    const unique = [];
    comments.forEach((c) => {
      const idKey = (c.comment_id || "").trim();
      if (idKey) {
        if (seenIds.has(idKey)) return;
        seenIds.add(idKey);
      }
      const key = `${c.user}::${c.ip}::${c.content}`;
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(c);
    });

    if (!unique.length) {
      showToast("未找到评论。", "error");
      hideProgress();
      running = false;
      return;
    }

    const postId =
      (location.pathname.match(/\d{4,}/) || [Date.now().toString()])[0];
    const csv = toCsv(unique);
    const filename = `post_${postId}_comments.csv`;
    downloadCsv(csv, filename);
    showProgress(100, "CSV 生成完成");
    showToast(`已下载：${filename}`);
    try {
      chrome.runtime.sendMessage({
        type: "XHH_OPEN_ANALYZER",
        csv,
        filename
      });
    } catch (err) {
      // ignore if messaging not available
    }

    hideProgress();
    running = false;
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "XHH_EXPORT_COMMENTS") {
      runExport({ trigger: "action" });
      sendResponse({ status: "started" });
      return true;
    }
    return false;
  });

  const bootstrap = () => {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      ensureButton();
    } else {
      document.addEventListener("DOMContentLoaded", ensureButton, { once: true });
    }

    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        ensureButton();
      }
    }, 1500);
  };

  bootstrap();
})();
