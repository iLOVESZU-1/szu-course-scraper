(() => {
  const VERSION = "0.7.5";
  if (window.__courseScraperLoadedVersion === VERSION) {
    return;
  }
  window.__courseScraperLoaded = true;
  window.__courseScraperLoadedVersion = VERSION;

  const LAST_RESULT_KEY = "courseScraper:lastResult";
  const AUTO_HOSTS_KEY = "courseScraper:autoHosts:v2";
  const CONTENT_SOURCE = "course-scraper-content";
  const POPUP_SOURCE = "course-scraper-popup:0.7.5";
  const POPUP_SOURCES = new Set([POPUP_SOURCE, "course-scraper-popup:0.4.9", "course-scraper-popup:0.4.8", "course-scraper-popup:0.4.7", "course-scraper-popup:0.4.6", "course-scraper-popup:0.4.5", "course-scraper-popup:0.4.4", "course-scraper-popup:0.4.3", "course-scraper-popup:0.4.2", "course-scraper-popup:0.4.1", "course-scraper-popup:0.4.0", "course-scraper-popup:0.3.1", "course-scraper-popup:0.3.0", "course-scraper-popup:0.2.4", "course-scraper-popup:0.2.3", "course-scraper-popup:0.2.2", "course-scraper-popup-v2", "course-scraper-popup"]);

  const FIELD_ALIASES = {
    courseName: ["课程名称", "课程名", "教学班名称", "课程", "科目", "名称"],
    sections: ["上课节次", "上课节数", "节次", "节数", "课节", "总学时", "学时"],
    credits: ["课程学分", "学分数", "学分"],
    teacher: ["任课教师", "授课教师", "主讲教师", "任课老师", "授课老师", "教师姓名", "教师", "老师"],
    weeks: ["起止周", "授课周次", "上课周次", "上课周", "教学周", "周次", "周数"],
    time: ["上课时间", "上课安排", "上课日期", "上课星期", "时间", "星期"],
    courseCategory: ["课程类别", "课程类型", "类别"],
    courseNature: ["课程性质", "性质"]
  };

  const ALL_LABELS = Object.values(FIELD_ALIASES).flat().sort((a, b) => b.length - a.length);
  const WEEKDAY_RE = /(星期[一二三四五六日天]|周[一二三四五六日天]|礼拜[一二三四五六日天]|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)/i;
  const SECTION_RE = /(?:第\s*)?\d{1,2}\s*(?:[-~至到\u2013\u2014]\s*\d{1,2})?\s*节/;
  const SECTION_GLOBAL_RE = /(?:第\s*)?\d{1,2}\s*(?:[-~至到\u2013\u2014]\s*\d{1,2})?\s*节/g;
  const TIME_RANGE_RE = /\d{1,2}:\d{2}\s*(?:[-~至到\u2013\u2014]\s*)\d{1,2}:\d{2}/;
  const WEEK_RANGE_RE = /(?:第\s*)?\d{1,2}\s*(?:[-~至到\u2013\u2014]\s*\d{1,2})?\s*(?:周|周次)/;
  const DETAIL_CONTROL_RE = /(课程详情|教学班详情|查看详情|详情|明细|上课安排|授课安排|展开|查看)/;
  const DETAIL_CONTROL_NEGATIVE_RE = /(复制|下载|导出|删除|保存|提交|选课|退选|收藏|帮助|刷新|搜索|查询)/;
  const MAX_DETAIL_CLICKS = 200;

  let picker = null;
  let activeExpandJob = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!POPUP_SOURCES.has(message?.source)) {
      return undefined;
    }

    handleMessage(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message || "操作失败" }));

    return true;
  });

  setTimeout(checkAutoScrape, 700);

  async function handleMessage(message) {
    switch (message.type) {
      case "EXPAND_ALL":
      case "EXPAND_DETAILS":
      case "EXPAND_SCRAPE":
      case "EXPAND_AND_CRAWL":
      case "EXPAND_AND_SCRAPE": {
        return startExpandJob("展开爬取", {
          selectedGroupKeys: message.payload?.selectedGroupKeys || null
        });
      }
      case "SCAN_COURSE_GROUPS": {
        const groups = scanCourseGroups(document.body);
        const directCourses = extractPublicElectiveTableCourses(document.body);
        return {
          ok: true,
          groups,
          count: groups.length,
          result: directCourses.length ? buildDirectPublicResult(directCourses, "校公选课当前页") : null
        };
      }
      case "SCAN_COURSE_GROUPS_ALL_PAGES": {
        return scanCourseGroupsAcrossPages(message.payload || {});
      }
      case "EXPAND_SELECTED_COURSES": {
        const selectedGroupKeys = Array.isArray(message.payload?.selectedGroupKeys)
          ? message.payload.selectedGroupKeys.filter(Boolean)
          : [];
        if (!selectedGroupKeys.length) {
          return { ok: false, error: "请先勾选至少一个课程大类" };
        }
        return startExpandJob("勾选大类爬取", { selectedGroupKeys, accumulateSelected: true });
      }
      case "EXPAND_SELECTED_COURSES_ALL_PAGES": {
        const selectedGroupKeys = Array.isArray(message.payload?.selectedGroupKeys)
          ? message.payload.selectedGroupKeys.filter(Boolean)
          : [];
        if (!selectedGroupKeys.length) {
          return { ok: false, error: "请先勾选至少一个课程大类" };
        }
        return startExpandAllPagesJob(selectedGroupKeys, message.payload || {});
      }
      case "PREVIEW_SELECTED_COURSES": {
        const selectedGroupKeys = Array.isArray(message.payload?.selectedGroupKeys)
          ? message.payload.selectedGroupKeys.filter(Boolean)
          : [];
        if (!selectedGroupKeys.length) {
          return { ok: false, error: "请先勾选至少一个课程大类" };
        }
        return startExpandJob("网页预览", { selectedGroupKeys, previewOnly: true });
      }
      case "SHOW_CALENDAR": {
        const courses = Array.isArray(message.payload?.courses) ? message.payload.courses : [];
        if (!courses.length) {
          return { ok: false, error: "没有可显示的课程" };
        }
        showCourseCalendar(courses);
        return { ok: true, count: courses.length };
      }
      case "UPDATE_CALENDAR": {
        const courses = Array.isArray(message.payload?.courses) ? message.payload.courses : [];
        if (!courses.length || !document.getElementById("course-scraper-calendar")) {
          return { ok: true, updated: false };
        }
        showCourseCalendar(courses);
        return { ok: true, updated: true, count: courses.length };
      }
      case "SCRAPE_PAGE": {
        const result = buildResult(document.body, "整页爬取");
        await saveResult(result);
        notifyPopup(result);
        return { ok: true, result };
      }
      case "SCRAPE_SELECTION": {
        const selection = String(window.getSelection?.() || "").trim();
        if (!selection) {
          return { ok: false, error: "当前页面没有选中文字" };
        }
        const result = buildResultFromPlainText(selection, "选中文字");
        await saveResult(result);
        notifyPopup(result);
        return { ok: true, result };
      }
      case "START_PICK": {
        startPicker();
        return { ok: true };
      }
      case "AUTO_STATE_CHANGED": {
        if (message.payload?.enabled) {
          return startExpandJob("自动展开爬取", { quiet: true, toast: true });
        }
        return { ok: true };
      }
      default:
        return { ok: false, error: "未知操作" };
    }
  }

  function startExpandJob(scope, options = {}) {
    if (activeExpandJob) {
      return {
        ok: true,
        accepted: true,
        message: "已有展开爬取任务在运行，请等待结果更新。"
      };
    }

    activeExpandJob = (async () => {
      try {
        let result = await expandDetailsAndBuildResult(document.body, scope, options);
        if (options.accumulateSelected) {
          result = await mergeAccumulatedSelectedResult(result);
        }
        if (options.previewOnly) {
          showWebPreview(result);
          notifyPreviewDone(result.courses.length);
        } else {
          await saveResult(result);
          notifyPopup(result);
        }
        if (options.toast) {
          showToast(`自动爬取完成：${result.courses.length} 门课程`);
        }
      } catch (error) {
        notifyError(error.message || "展开爬取失败，请刷新页面后重试。");
      } finally {
        activeExpandJob = null;
      }
    })();

    return {
      ok: true,
      accepted: true,
      message: "已开始后台展开课程详情，结果会自动更新到表格。"
    };
  }

  function startExpandAllPagesJob(selectedGroupKeys, options = {}) {
    if (activeExpandJob) {
      return {
        ok: true,
        accepted: true,
        message: "已有展开爬取任务正在运行，请等待结果更新。"
      };
    }

    activeExpandJob = (async () => {
      try {
        const result = await expandSelectedCoursesAcrossPages(selectedGroupKeys, options);
        await saveResult(result);
        notifyPopup(result);
        showToast(`自动翻页爬取完成：${result.count} 门课程`);
      } catch (error) {
        notifyError(error.message || "自动翻页爬取失败，请刷新页面后重试。");
      } finally {
        activeExpandJob = null;
      }
    })();

    return {
      ok: true,
      accepted: true,
      message: "已开始自动翻页爬取，完成后会更新课程表。"
    };
  }

  async function expandSelectedCoursesAcrossPages(selectedGroupKeys, options = {}) {
    const selected = [...new Set(selectedGroupKeys)];
    const visitedPages = new Set();
    let result = null;
    let pages = 0;
    const maxPages = normalizePageLimit(options.maxPages);
    const pageDelayMs = normalizePageDelay(options.pageDelayMs);
    const pattern = compileCourseRegex(options.courseRegex);

    while (pages < maxPages) {
      const pageKey = pageSignature();
      if (visitedPages.has(pageKey)) {
        break;
      }
      visitedPages.add(pageKey);
      const pageResult = await expandDetailsAndBuildResult(document.body, "跨页自动爬取", {
        selectedGroupKeys: selected,
        accumulateSelected: true,
        skipMissingSelected: true,
        detailDelayMs: options.detailDelayMs
      });
      result = mergePageResults(result, pageResult);
      pages += 1;

      const next = findNextPageControl();
      if (!next) {
        break;
      }
      ensureSessionActive();
      notifyProgress(`已完成第 ${pages} 页，限速等待后继续翻页...`);
      await politeWait(pageDelayMs);
      dispatchMouseClick(next);
      if (!await waitForPageChange(pageKey)) {
        break;
      }
      ensureSessionActive();
    }

    if (result) {
    if (pattern) {
      result.courses = result.courses.filter((course) => pattern.test([course.courseName, course.courseNumber, course.courseCategory, course.rawText].filter(Boolean).join("\n")));
      result.count = result.courses.length;
    }
      result.returnedToFirstPage = await returnToFirstPage(Math.max(500, Math.round(pageDelayMs * 0.55)));
      result.closedExpandedCount = await closeAllExpandedCourseDetails();
    }

    if (!result?.courses?.length) {
      throw new Error("没有在已勾选大类中找到可爬取的教学班");
    }
    return { ...result, scope: `跨 ${pages} 页自动爬取`, pageCount: pages };
  }

  async function closeAllExpandedCourseDetails() {
    const rows = [...document.querySelectorAll(".cv-row[coursenumber]")]
      .filter((row) => isVisible(row) && isCourseRowVisiblyExpanded(row));
    let closed = 0;
    for (const row of rows) {
      const control = row.querySelector(":scope > .cv-class, .cv-class");
      if (!control || !isVisible(control) || !isCourseRowVisiblyExpanded(row)) {
        continue;
      }
      clickElementSafely(control);
      await sleep(180);
      if (!isCourseRowVisiblyExpanded(row)) {
        closed += 1;
      }
    }
    return closed;
  }

  function isCourseRowVisiblyExpanded(row) {
    const details = row.querySelectorAll(":scope > .cv-course-table, :scope > .cv-course-card, .cv-course-table, .cv-course-card");
    return [...details].some((detail) => isVisible(detail));
  }

  function mergePageResults(existing, pageResult) {
    if (!existing) {
      return pageResult;
    }
    const courses = dedupeCourses([...(existing.courses || []), ...(pageResult.courses || [])]);
    return {
      ...pageResult,
      count: courses.length,
      courses,
      expandedCount: Number(existing.expandedCount || 0) + Number(pageResult.expandedCount || 0),
      detailCourseCount: Number(existing.detailCourseCount || 0) + Number(pageResult.detailCourseCount || 0),
      processedGroupKeys: [...new Set([...(existing.processedGroupKeys || []), ...(pageResult.processedGroupKeys || [])])],
      accumulatedSelection: true
    };
  }

  function showWebPreview(result) {
    showCourseCalendar(coursesToCalendarEvents(result.courses));
  }

  function coursesToCalendarEvents(courses) {
    return (courses || []).flatMap((course) => parseCalendarSessions(course.time || "").map((session) => ({
      courseName: course.courseName || "未命名课程",
      teacher: course.teacher || "",
      credits: course.credits || "",
      weeks: session.weeks || course.weeks || "",
      time: course.time || "",
      day: session.day,
      start: session.start,
      end: session.end
    })));
  }

  function parseCalendarSessions(value) {
    const chunks = String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "\n")
      .split(/[；;\n]+/)
      .map((chunk) => chunk.replace(/^\s*[·•]\s*/, "").trim())
      .filter(Boolean);
    const sessions = [];
    let pendingWeeks = "";
    for (const chunk of chunks) {
      const weekMatches = [...chunk.matchAll(/(\d{1,2})(?:\s*[-~至到–—]\s*(\d{1,2}))?\s*周/g)];
      const weeks = weekMatches.map((match) => match[2] ? `${match[1]}-${match[2]}周` : `${match[1]}周`).join("、");
      const dayMatch = chunk.match(/(?:星期|周|礼拜)([一二三四五六日天七])/);
      const sectionMatch = chunk.match(/(?:第\s*)?(\d{1,2})(?:\s*[-~至到–—]\s*(\d{1,2}))?\s*节/);
      if (!dayMatch || !sectionMatch) {
        if (weeks) {
          pendingWeeks = pendingWeeks ? `${pendingWeeks}、${weeks}` : weeks;
        }
        continue;
      }
      const dayMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 七: 7 };
      const start = Number(sectionMatch[1]);
      const end = Number(sectionMatch[2] || sectionMatch[1]);
      sessions.push({
        day: dayMap[dayMatch[1]],
        start,
        end,
        weeks: [pendingWeeks, weeks].filter(Boolean).join("、")
      });
      pendingWeeks = "";
    }
    return sessions;
  }

  function showCourseCalendar(courses) {
    document.getElementById("course-scraper-web-preview")?.remove();
    document.getElementById("course-scraper-calendar")?.remove();
    const panel = document.createElement("section");
    panel.id = "course-scraper-calendar";
    panel.style.cssText = [
      "position:fixed", "z-index:2147483647", "top:12px", "left:12px",
      "width:clamp(320px,calc(100vw - 660px),840px)", "min-height:280px", "max-height:94vh", "overflow:auto", "resize:both", "padding:16px",
      "border:1px solid #cfd8e8", "border-radius:10px", "background:#fff", "box-shadow:0 14px 42px rgba(20,35,65,.26)",
      "font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif", "color:#172033"
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;font-weight:700;font-size:17px";
    const title = document.createElement("span");
    title.textContent = "我的课表";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "关闭";
    close.style.cssText = "border:1px solid #dfe3eb;border-radius:6px;background:#fff;padding:5px 12px;cursor:pointer;color:#38435a";
    close.addEventListener("click", () => panel.remove());
    header.append(title, close);

    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:54px repeat(7,minmax(104px,1fr));grid-auto-rows:52px;min-width:790px;border-top:1px solid #d9e1ee;border-left:1px solid #d9e1ee;background:#fff";
    const headers = ["节次", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    for (const label of headers) {
      const cell = document.createElement("div");
      cell.textContent = label;
      const headerIndex = headers.indexOf(label);
      cell.style.cssText = `grid-column:${headerIndex + 1};grid-row:1;display:flex;align-items:center;justify-content:center;padding:5px;background:#eef4fc;border-right:1px solid #d9e1ee;border-bottom:1px solid #d9e1ee;font-weight:650;color:#38435a`;
      grid.append(cell);
    }
    for (let period = 1; period <= 14; period += 1) {
      const label = document.createElement("div");
      label.textContent = `${period <= 6 ? "上午" : period <= 10 ? "下午" : "晚上"}\n${period}`;
      label.style.cssText = `grid-column:1;grid-row:${period + 1};display:flex;align-items:center;justify-content:center;white-space:pre-line;text-align:center;background:#f5f7fb;border-right:1px solid #d9e1ee;border-bottom:1px solid #d9e1ee;color:#526078`;
      grid.append(label);
      for (let day = 1; day <= 7; day += 1) {
        const empty = document.createElement("div");
        empty.style.cssText = `grid-column:${day + 1};grid-row:${period + 1};border-right:1px solid #d9e1ee;border-bottom:1px solid #d9e1ee;background:#fff`;
        grid.append(empty);
      }
    }

    const colors = ["#e8f1ff", "#eaf8f1", "#fff3df", "#f5ebff", "#ffecee", "#e7f8f7"];
    courses.forEach((course, index) => {
      const day = Number(course.day);
      const start = Number(course.start);
      const end = Number(course.end);
      if (day < 1 || day > 7 || start < 1 || end < start || end > 14) {
        return;
      }
      const event = document.createElement("div");
      event.style.cssText = [
        `grid-column:${day + 1}`, `grid-row:${start + 1} / ${end + 2}`, "z-index:2", "margin:3px", "padding:5px",
        "overflow:hidden", "border:1px solid #c8d5e8", "border-radius:5px", `background:${colors[index % colors.length]}`,
        "color:#172033", "font-size:12px", "line-height:1.35", "box-shadow:0 1px 2px rgba(20,35,65,.08)"
      ].join(";");
      const name = document.createElement("strong");
      name.textContent = course.courseName || "未命名课程";
      name.style.display = "block";
      const detail = document.createElement("span");
      detail.textContent = [course.weeks, course.teacher, course.time, course.credits ? `${course.credits}学分` : ""]
        .filter(Boolean)
        .join("\n");
      detail.style.cssText = "display:block;white-space:pre-line;margin-top:2px";
      event.append(name, detail);
      grid.append(event);
    });

    panel.append(header, grid);
    document.body.append(panel);
  }

  async function expandDetailsAndBuildResult(root, scope, options = {}) {
    let selectedGroupKeys = Array.isArray(options.selectedGroupKeys) ? new Set(options.selectedGroupKeys) : null;
    const directPublicCourses = extractPublicElectiveTableCourses(root);
    if (directPublicCourses.length) {
      const pageResult = buildResult(root, scope);
      return {
        ...pageResult,
        scope,
        count: directPublicCourses.length,
        expandedCount: 0,
        detailCourseCount: directPublicCourses.length,
        accumulatedSelection: Boolean(selectedGroupKeys),
        processedGroupKeys: selectedGroupKeys ? [...selectedGroupKeys] : [],
        courses: directPublicCourses
      };
    }
    const controls = findCourseDetailControls(root)
      .filter((control) => !selectedGroupKeys || selectedGroupKeys.has(courseGroupKeyFromControl(control)))
      .slice(0, MAX_DETAIL_CLICKS);
    const detailCourses = [];
    let expandedCount = 0;

    const noSelectedControls = Boolean(options.skipMissingSelected && selectedGroupKeys && controls.length === 0);
    if (noSelectedControls) {
      selectedGroupKeys = null;
    }

    if (selectedGroupKeys && controls.length === 0) {
      throw new Error("没有找到已勾选的大类，请重新读取课程大类后再试");
    }

    if (!options.quiet) {
      notifyProgress(`找到 ${controls.length} 个课程详情入口，正在展开...`);
    }

    for (let index = 0; index < controls.length; index += 1) {
      const control = controls[index];
      if (!isConnectedElement(control) || !isVisible(control)) {
        continue;
      }

      const openerCourse = parseCourseFromControlContext(control);
      if (isAlreadyExpanded(control)) {
        const expandedRow = control.closest?.(".cv-row[coursenumber]");
        if (expandedRow) {
          detailCourses.push(...extractSzuTeachingClassCards(expandedRow, openerCourse));
        }
        continue;
      }

      if (!options.quiet) {
        notifyProgress(`正在展开课程详情 ${expandedCount + 1}/${controls.length}...`);
      }

      const detail = await openCourseDetail(control);
      expandedCount += 1;

      const extracted = extractCoursesFromDetail(detail, openerCourse);
      detailCourses.push(...extracted);

      if (detail?.kind === "modal" && detail.container) {
        await closeDetailContainer(detail.container);
      }

      if (options.detailDelayMs) {
        await politeWait(normalizeDetailDelay(options.detailDelayMs));
      } else {
        await sleep(90);
      }
    }

    await sleep(220);
    const pageResult = buildResult(root, scope);
    const courses = dedupeCourses(noSelectedControls ? [] : selectedGroupKeys ? detailCourses : detailCourses.length ? detailCourses : pageResult.courses);

    return {
      ...pageResult,
      scope,
      count: courses.length,
      expandedCount,
      detailCourseCount: detailCourses.length,
      accumulatedSelection: Boolean(selectedGroupKeys),
      processedGroupKeys: selectedGroupKeys
        ? [...new Set(controls.map(courseGroupKeyFromControl).filter(Boolean))]
        : [],
      courses
    };
  }

  async function mergeAccumulatedSelectedResult(result) {
    const hostKey = resultKeyForHost(location.host);
    const data = await storageGet([hostKey, LAST_RESULT_KEY]);
    const existing = data[hostKey] || data[LAST_RESULT_KEY];
    if (!existing?.accumulatedSelection) {
      return result;
    }

    const courses = dedupeCourses([...(existing.courses || []), ...(result.courses || [])]);
    return {
      ...result,
      scope: "跨页累计勾选大类爬取",
      count: courses.length,
      expandedCount: Number(existing.expandedCount || 0) + Number(result.expandedCount || 0),
      processedGroupKeys: [...new Set([...(existing.processedGroupKeys || []), ...(result.processedGroupKeys || [])])],
      courses
    };
  }

  function buildResult(root, scope) {
    const structuredCourses = extractFromStructuredRows(root);
    const tableCourses = extractFromTables(root);
    const publicElectiveCourses = extractPublicElectiveTableCourses(root);
    const courses = dedupeCourses([
      ...structuredCourses,
      ...tableCourses,
      ...publicElectiveCourses,
      ...(structuredCourses.length || tableCourses.length ? [] : extractFromCards(root))
    ]);

    return {
      version: VERSION,
      scope,
      url: location.href,
      title: document.title,
      scrapedAt: new Date().toISOString(),
      count: courses.length,
      courses
    };
  }

  function extractPublicElectiveTableCourses(root) {
    const courses = [];
    for (const currentRoot of getQueryableRoots(root)) {
      const rows = currentRoot.querySelectorAll?.(".public-list .cv-body > .cv-row, .cv-list.public-list .cv-row") || [];
      for (const row of rows) {
        if (!isVisible(row) || row.matches(".cv-head") || !row.querySelector(".cv-title-col")) {
          continue;
        }
        const rawText = getElementText(row);
        const numberText = getFirstText(row, [".cv-number-col"]);
        const courseNumber = oneLine(numberText).match(/\d{6,}(?:\[\d+\])?/)?.[0] || "";
        const courseTotalNumber = cleanValue(getFirstText(row, [".cv-courseTotalNumber"]));
        const courseName = cleanValue((getFirstText(row, [".cv-title-col"]) || "").replace(/\s*\[冲突\]\s*$/, ""));
        const time = cleanValue(getFirstText(row, [".cv-time-col"]));
        if (!courseName || !time) {
          continue;
        }
        courses.push(normalizeCourse({
          courseName,
          courseNumber,
          courseTotalNumber,
          sections: findSections(time),
          credits: cleanValue(getFirstText(row, [".cv-credit-col"])),
          teacher: cleanValue(getFirstText(row, [".cv-teacher-col"])),
          weeks: findWeeks(time),
          time,
          courseCategory: "校公选课",
          courseNature: "选修",
          source: "深大校公选课",
          rawText
        }));
      }
    }
    for (const table of queryTables(root)) {
      if (!isVisible(table) || looksLikeSearchFilterTable(table)) {
        continue;
      }
      const grid = buildTableGrid(table);
      const rows = grid.map((row) => row.map((cell) => cell?.text || ""));
      const headerIndex = findHeaderRow(rows);
      if (headerIndex < 0) {
        continue;
      }
      const headers = rows[headerIndex].map((header) => oneLine(header).replace(/\s+/g, ""));
      const nameColumn = headers.findIndex((header) => /课程名称|课程名/.test(header));
      const teacherColumn = headers.findIndex((header) => /上课教师|任课教师|授课教师/.test(header));
      const timeColumn = headers.findIndex((header) => /上课时间地点|上课时间|时间地点/.test(header));
      const creditColumn = headers.findIndex((header) => /^学分$|课程学分/.test(header));
      const numberColumn = headers.findIndex((header) => /课程编号|课程序号|课程号/.test(header));
      if (nameColumn < 0 || teacherColumn < 0 || timeColumn < 0 || creditColumn < 0) {
        continue;
      }

      for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        const courseName = cleanValue(row[nameColumn] || "");
        const time = cleanValue(row[timeColumn] || "");
        if (!courseName || !time || looksLikeHeaderRow(row)) {
          continue;
        }
        const numberText = oneLine(row[numberColumn] || "");
        const courseNumber = numberText.match(/\d{6,}/)?.[0] || "";
        const rawText = uniqueValues(row.filter((value) => !isDetailActionText(value))).join("\n");
        courses.push(normalizeCourse({
          courseName,
          courseNumber,
          sections: findSections(time),
          credits: cleanValue(row[creditColumn] || ""),
          teacher: cleanValue(row[teacherColumn] || ""),
          weeks: findWeeks(time),
          time,
          courseCategory: "校公选课",
          courseNature: "选修",
          source: "深大校公选课",
          rawText
        }));
      }
    }
    return dedupeCourses(courses);
  }

  function buildDirectPublicResult(courses, scope) {
    return {
      version: VERSION,
      scope,
      url: location.href,
      title: document.title,
      scrapedAt: new Date().toISOString(),
      count: courses.length,
      accumulatedSelection: false,
      processedGroupKeys: [],
      courses: dedupeCourses(courses)
    };
  }

  function scanCourseGroups(root) {
    const groups = [];
    const seen = new Set();
    for (const currentRoot of getQueryableRoots(root)) {
      const rows = currentRoot.querySelectorAll?.(".cv-list .cv-body > .cv-row[coursenumber], .cv-body > .cv-row[coursenumber]") || [];
      for (const row of rows) {
        if (!isVisible(row) || row.closest(".cv-course-table")) {
          continue;
        }
        const course = parseStructuredCourseRow(row, null);
        if (!isMeaningfulCourse(course, true) || isStructuredCategoryRow(row, course)) {
          continue;
        }
        const key = courseGroupKeyFromRow(row, course);
        if (!key || seen.has(key)) {
          continue;
        }
        seen.add(key);
        groups.push({
          key,
          courseName: course.courseName,
          credits: course.credits,
          courseCategory: course.courseCategory,
          courseNature: course.courseNature,
          classCount: cleanValue(getFirstText(row, [":scope > .cv-class", ".cv-class"])),
          courseNumber: cleanValue(row.getAttribute("coursenumber") || getFirstText(row, [":scope > .cv-num", ".cv-num"]))
        });
      }
    }
    return groups;
  }

  async function scanCourseGroupsAcrossPages(options = {}) {
    const allGroups = new Map();
    const allDirectCourses = new Map();
    const visitedPages = new Set();
    let pages = 0;
    const maxPages = normalizePageLimit(options.maxPages);
    const pageDelayMs = normalizePageDelay(options.pageDelayMs);
    const pattern = compileCourseRegex(options.courseRegex);

    while (pages < maxPages) {
      const pageKey = pageSignature();
      if (visitedPages.has(pageKey)) {
        break;
      }
      visitedPages.add(pageKey);
      for (const course of extractPublicElectiveTableCourses(document.body)) {
        const key = [course.courseNumber, course.courseName, course.teacher, course.time].join("|").replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
        if (!pattern || pattern.test([course.courseName, course.courseNumber, course.courseCategory, course.rawText].filter(Boolean).join("\n"))) {
          allDirectCourses.set(key, course);
        }
      }
      for (const group of scanCourseGroups(document.body)) {
        if (!pattern || pattern.test([group.courseName, group.courseNumber, group.courseCategory, group.courseNature].filter(Boolean).join("\n"))) {
          allGroups.set(group.key, group);
        }
      }
      pages += 1;

      const next = findNextPageControl();
      if (!next) {
        break;
      }
      ensureSessionActive();
      notifyProgress(`已完成第 ${pages} 页，限速等待后继续翻页...`);
      await politeWait(pageDelayMs);
      dispatchMouseClick(next);
      const changed = await waitForPageChange(pageKey);
      if (!changed) {
        break;
      }
      ensureSessionActive();
    }

    const returnedToFirstPage = await returnToFirstPage(Math.max(1000, Math.round(pageDelayMs * 0.55)));

    return {
      ok: true,
      groups: [...allGroups.values()],
      count: allGroups.size,
      pages,
      returnedToFirstPage,
      result: allDirectCourses.size ? buildDirectPublicResult([...allDirectCourses.values()], `校公选课跨 ${pages} 页`) : null
    };
  }

  function findNextPageControl() {
    const publicNext = document.getElementById("publicDown");
    if (extractPublicElectiveTableCourses(document.body).length && publicNext && isVisible(publicNext) && !isDisabledControl(publicNext)) {
      return publicNext;
    }
    const candidates = [...document.querySelectorAll("a,button,[role='button'],li,span")];
    return candidates
      .filter((node) => isVisible(node) && !isDisabledControl(node))
      .map((node) => ({ node, marker: [node.innerText, node.getAttribute("aria-label"), node.getAttribute("title"), node.className].filter(Boolean).join(" ").trim() }))
      .filter(({ marker }) => /下一页|下一頁|下页|next\s*page|next|›|»/i.test(marker))
      .sort((a, b) => a.marker.length - b.marker.length)[0]?.node || null;
  }

  function normalizePageLimit(value) {
    return Math.max(1, Math.min(50, Number.parseInt(value, 10) || 50));
  }

  function normalizePageDelay(value) {
    return Math.max(500, Math.min(15000, Number.parseInt(value, 10) || 500));
  }

  function normalizeDetailDelay(value) {
    return Math.max(400, Math.min(2500, Number.parseInt(value, 10) || 800));
  }

  async function politeWait(baseDelay) {
    const jitter = 0.8 + Math.random() * 0.4;
    await sleep(Math.round(baseDelay * jitter));
  }

  function ensureSessionActive() {
    const url = String(location.href || "");
    const hasPassword = Boolean(document.querySelector("input[type='password']"));
    if (hasPassword || /login|authserver|cas\/login/i.test(url)) {
      throw new Error("检测到登录已失效，自动爬取已停止，请重新登录后降低速度重试");
    }
  }

  function compileCourseRegex(value) {
    const text = String(value || "").trim();
    if (!text) {
      return null;
    }
    try {
      return new RegExp(text, "i");
    } catch {
      throw new Error("课程正则表达式格式错误");
    }
  }

  function findPreviousPageControl() {
    const publicPrevious = document.getElementById("publicUp");
    if (extractPublicElectiveTableCourses(document.body).length && publicPrevious && isVisible(publicPrevious) && !isDisabledControl(publicPrevious)) {
      return publicPrevious;
    }
    const candidates = [...document.querySelectorAll("a,button,[role='button'],li,span")];
    return candidates
      .filter((node) => isVisible(node) && !isDisabledControl(node))
      .map((node) => ({ node, marker: [node.innerText, node.getAttribute("aria-label"), node.getAttribute("title"), node.className].filter(Boolean).join(" ").trim() }))
      .filter(({ marker }) => /上一页|上一頁|上页|previous\s*page|prev|‹|«/i.test(marker))
      .sort((a, b) => a.marker.length - b.marker.length)[0]?.node || null;
  }

  async function returnToFirstPage(delayMs = 1000) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const previous = findPreviousPageControl();
      if (!previous) {
        return true;
      }
      const before = pageSignature();
      ensureSessionActive();
      await politeWait(delayMs);
      dispatchMouseClick(previous);
      if (!await waitForPageChange(before)) {
        return true;
      }
      ensureSessionActive();
    }
    return false;
  }

  function isDisabledControl(node) {
    return node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true"
      || /disabled|禁用|不可用/i.test(String(node.className || ""));
  }

  function dispatchMouseClick(node) {
    const preventJavaScriptUrl = (event) => {
      if (/^javascript:/i.test(String(node.getAttribute("href") || ""))) {
        event.preventDefault();
      }
    };
    node.addEventListener("click", preventJavaScriptUrl, { capture: true, once: true });
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }

  function pageSignature() {
    const groups = scanCourseGroups(document.body);
    const publicCourses = extractPublicElectiveTableCourses(document.body);
    const active = [...document.querySelectorAll(".active,.current,.bh-pagination-current,[aria-current='page']")]
      .map((node) => cleanValue(node.innerText || node.textContent || "")).filter(Boolean).join("|");
    const publicKey = publicCourses.map((course) => [course.courseName, course.teacher, course.time].join("|")).join("||");
    return `${active}||${groups.map((group) => group.key).join("|")}||${publicKey}`;
  }

  async function waitForPageChange(previousSignature) {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await sleep(120);
      if (pageSignature() !== previousSignature) {
        return true;
      }
    }
    return false;
  }

  function courseGroupKeyFromControl(control) {
    const row = control.closest?.(".cv-row[coursenumber]");
    return row ? courseGroupKeyFromRow(row, parseStructuredCourseRow(row, null)) : "";
  }

  function courseGroupKeyFromRow(row, course) {
    const number = cleanValue(row.getAttribute?.("coursenumber") || "");
    const name = cleanValue(course?.courseName || "");
    return [number, name].filter(Boolean).join("|").toLocaleLowerCase("zh-CN");
  }

  function findCourseDetailControls(root) {
    const selectors = [
      ".cv-row[coursenumber] > .cv-class",
      "a",
      "button",
      "span.cv-detail",
      ".cv-detail",
      "[data-num]",
      "[role='button']",
      "[onclick]",
      ".el-link",
      ".ant-btn-link",
      ".ivu-btn",
      ".layui-btn"
    ];
    const candidates = new Set();
    const roots = getQueryableRoots(root);

    for (const currentRoot of roots) {
      if (isElementNode(currentRoot) && currentRoot.matches?.(selectors.join(","))) {
        candidates.add(currentRoot);
      }

      for (const selector of selectors) {
        try {
          for (const node of currentRoot.querySelectorAll?.(selector) || []) {
            candidates.add(node);
          }
        } catch {
          // Ignore unsupported selectors on older pages.
        }
      }
    }

    return [...candidates].filter(isCourseDetailControl);
  }

  function isCourseDetailControl(element) {
    if (!isElementNode(element) || !isVisible(element)) {
      return false;
    }
    if (String(element.id || "").startsWith("course-scraper")) {
      return false;
    }

    const text = getControlText(element);
    if (!text || text.length > 80 || DETAIL_CONTROL_NEGATIVE_RE.test(text) || /收起/.test(text)) {
      return false;
    }

    if (isTeachingClassTrigger(element)) {
      return true;
    }

    if (element.matches?.(".cv-detail") && element.closest(".cv-row[coursenumber]")?.querySelector(":scope > .cv-class")) {
      return false;
    }

    if (element.matches?.(".cv-detail, .cv-detail[data-num], [data-num].cv-detail") && hasLikelyCourseContext(element)) {
      return true;
    }

    if (/(课程详情|教学班详情|查看详情|详情|明细|上课安排|授课安排)/.test(text)) {
      return true;
    }

    return /(展开|查看)/.test(text) && hasLikelyCourseContext(element);
  }

  function isTeachingClassTrigger(element) {
    const row = element.closest?.(".cv-row[coursenumber]");
    return Boolean(
      row &&
      element.matches?.(":scope.cv-class, .cv-class") &&
      row.querySelector(":scope > .cv-course") &&
      /^\d+$/.test(oneLine(element.textContent || ""))
    );
  }

  function getControlText(element) {
    return uniqueValues([
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.innerText,
      element.textContent
    ]).join(" ");
  }

  function hasLikelyCourseContext(element) {
    const row = element.closest("tr,[role='row'],.cv-row,li,article");
    if (!row) {
      return false;
    }

    const text = normalizeText(row.innerText || row.textContent || "");
    if (/课程|学分|教师|老师|周次|节次|课程号|课程代码/.test(text)) {
      return true;
    }

    const cells = row.querySelectorAll("td,th,[role='cell'],[role='gridcell']");
    return cells.length >= 4;
  }

  function isAlreadyExpanded(element) {
    const text = getControlText(element);
    const courseRow = element.closest?.(".cv-row[coursenumber]");
    return element.getAttribute("aria-expanded") === "true" ||
      /收起|已展开/.test(text) ||
      Boolean(courseRow && isCourseRowVisiblyExpanded(courseRow));
  }

  async function openCourseDetail(control) {
    const beforeText = getElementText(document.body);
    control.scrollIntoView?.({ block: "center", inline: "center" });
    await sleep(80);
    clickElementSafely(control);
    return waitForDetail(control, beforeText);
  }

  function clickElementSafely(element) {
    const anchor = element.closest?.("a[href]");
    let guard = null;
    if (anchor && mayNavigate(anchor)) {
      guard = (event) => {
        event.preventDefault();
      };
      anchor.addEventListener("click", guard, { capture: true, once: true });
    }

    const view = element.ownerDocument?.defaultView || window;
    const rect = element.getBoundingClientRect?.();
    const clientX = rect ? rect.left + rect.width / 2 : 0;
    const clientY = rect ? rect.top + rect.height / 2 : 0;
    const eventTypes = ["pointerover", "mouseover", "pointerenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click"];
    for (const type of eventTypes) {
      const EventConstructor = type.startsWith("pointer") && view.PointerEvent ? view.PointerEvent : view.MouseEvent;
      element.dispatchEvent(
        new EventConstructor(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view,
          button: 0,
          buttons: type.endsWith("down") ? 1 : 0,
          clientX,
          clientY
        })
      );
    }
  }

  function mayNavigate(anchor) {
    const href = anchor.getAttribute("href") || "";
    if (!href || href === "#" || href.startsWith("#") || /^javascript:/i.test(href)) {
      return false;
    }
    try {
      const currentHref = anchor.ownerDocument?.location?.href || location.href;
      const url = new URL(href, currentHref);
      return url.href.split("#")[0] !== currentHref.split("#")[0];
    } catch {
      return true;
    }
  }

  async function waitForDetail(control, beforeText) {
    const deadline = Date.now() + (isTeachingClassTrigger(control) ? 6000 : 3200);
    let best = null;
    while (Date.now() < deadline) {
      best = findBestDetailContainer(control, beforeText);
      if (best) {
        return best;
      }
      await sleep(120);
    }

    return {
      kind: "none",
      container: null,
      text: ""
    };
  }

  function findBestDetailContainer(control, beforeText) {
    if (isTeachingClassTrigger(control)) {
      const teachingClassRow = control.closest(".cv-row[coursenumber]");
      if (teachingClassRow?.classList.contains("cv-expand") && teachingClassRow.querySelector(".cv-course-card")) {
        return {
          kind: "inline",
          container: teachingClassRow,
          text: getElementText(teachingClassRow)
        };
      }
    }

    const modal = findBestContainer(queryModalContainers(), beforeText, control, true);
    if (modal) {
      return {
        kind: "modal",
        container: modal,
        text: getElementText(modal)
      };
    }

    const inline = findInlineDetailContainer(control, beforeText);
    if (inline) {
      return {
        kind: "inline",
        container: inline,
        text: getElementText(inline)
      };
    }

    return null;
  }

  function queryModalContainers() {
    const selectors = [
      "[role='dialog']",
      "[aria-modal='true']",
      ".modal",
      ".ant-modal",
      ".el-dialog",
      ".el-drawer",
      ".layui-layer",
      ".layui-layer-content",
      ".bh-window",
      ".bh-window-content",
      ".bh-dialog",
      ".bh-dialog-content",
      ".bh-popover",
      ".bh-modal",
      ".jqx-window",
      ".jqx-window-content",
      ".ui-dialog",
      ".cv-aside-choice",
      ".cv-search-list",
      ".cv-course-info",
      ".cv-teacher-item",
      "#course_teachingClass_div",
      "#data_div",
      ".schoolcourse-view-table",
      ".ivu-modal",
      ".arco-modal",
      ".van-popup",
      ".modal-dialog",
      ".modal-content",
      "[class*='dialog']",
      "[class*='Dialog']",
      "[class*='modal']",
      "[class*='Modal']",
      "[class*='drawer']",
      "[class*='Drawer']",
      "[class*='popup']",
      "[class*='Popup']",
      "[class*='window']",
      "[class*='Window']"
    ];
    const nodes = new Set();
    for (const root of getQueryableRoots(document.body)) {
      for (const selector of selectors) {
        try {
          for (const node of root.querySelectorAll?.(selector) || []) {
            nodes.add(node);
          }
        } catch {
          // Ignore unsupported selectors.
        }
      }
    }
    return [...nodes];
  }

  function findBestContainer(containers, beforeText, control, preferLayer) {
    let best = null;
    let bestScore = 0;
    for (const container of containers) {
      if (!isElementNode(container) || !isVisible(container)) {
        continue;
      }

      const text = getElementText(container);
      const score = scoreDetailContainer(container, text, beforeText, control, preferLayer);
      if (score > bestScore) {
        best = container;
        bestScore = score;
      }
    }
    return bestScore >= 3 ? best : null;
  }

  function scoreDetailContainer(container, text, beforeText, control, preferLayer) {
    if (!text || text.length < 8 || text.length > 15000) {
      return 0;
    }

    let score = scoreTextForCourse(text);
    if (/(课程详情|教学班详情|上课安排|授课安排|任课|授课|教师|老师|学分|周次|节次|时间)/.test(text)) {
      score += 2;
    }
    if (container.matches?.(".cv-course-info, .cv-teacher-item, #course_teachingClass_div, .cv-search-list, .schoolcourse-view-table")) {
      score += 2;
    }
    if (beforeText && !beforeText.includes(text.slice(0, Math.min(80, text.length)))) {
      score += 1;
    }
    if (preferLayer) {
      const style = window.getComputedStyle(container);
      const zIndex = Number(style.zIndex);
      if (container.getAttribute("role") === "dialog" || container.getAttribute("aria-modal") === "true") {
        score += 2;
      }
      if (Number.isFinite(zIndex) && zIndex >= 100) {
        score += 1;
      }
    }

    const openerCourse = parseCourseFromControlContext(control);
    if (openerCourse?.courseName && text.includes(openerCourse.courseName)) {
      score += 2;
    }

    return score;
  }

  function findInlineDetailContainer(control, beforeText) {
    const candidates = [];
    const courseRow = control.closest(".cv-row[coursenumber]");
    if (courseRow?.classList.contains("cv-expand") && courseRow.querySelector(".cv-course-card")) {
      candidates.push(courseRow);
    }
    const row = control.closest("tr,[role='row']");
    if (row) {
      let sibling = row.nextElementSibling;
      for (let step = 0; sibling && step < 4; step += 1) {
        candidates.push(sibling);
        sibling = sibling.nextElementSibling;
      }
    }

    const scope = control.closest("table,[role='table'],[role='grid'],section,main,div") || control.ownerDocument?.body || document.body;
    for (const selector of [
      ".el-table__expanded-cell",
      "[class*='expanded']",
      "[class*='Expanded']",
      "[class*='detail']",
      "[class*='Detail']"
    ]) {
      try {
        candidates.push(...scope.querySelectorAll(selector));
      } catch {
        // Ignore unsupported selectors.
      }
    }

    return findBestContainer(uniqueElements(candidates), beforeText, control, false);
  }

  function extractCoursesFromDetail(detail, openerCourse) {
    const text = detail?.text || "";
    let courses = [];
    if (detail?.container) {
      const teachingClassCourses = extractSzuTeachingClassCards(detail.container, openerCourse);
      const structuredCourses = extractFromStructuredRows(detail.container, openerCourse);
      const tableCourses = dedupeCourses([
        ...extractDetailTableRows(detail.container, openerCourse),
        ...extractFromTables(detail.container)
      ]);
      courses = teachingClassCourses.length
        ? teachingClassCourses
        : structuredCourses.length
          ? structuredCourses
          : tableCourses.length
            ? tableCourses
            : extractFromCards(detail.container);
    }
    if (!courses.length && text) {
      courses = extractFromPlainText(text, "课程详情");
    }
    if (!courses.length && text) {
      const parsed = parseCourse(text, { source: "课程详情" }, false);
      if (isMeaningfulCourse(parsed, false)) {
        courses = [parsed];
      }
    }
    if (!courses.length && openerCourse) {
      courses = [openerCourse];
    }

    return dedupeCourses(courses.map((course) => mergeCourses(openerCourse, course, text)).filter(Boolean));
  }

  function extractSzuTeachingClassCards(root, inheritedCourse) {
    const cards = [];
    if (root.matches?.(".cv-course-card")) {
      cards.push(root);
    }
    cards.push(...(root.querySelectorAll?.(".cv-course-card") || []));

    return dedupeCourses(uniqueElements(cards).map((card) => {
      if (!isVisible(card)) {
        return null;
      }

      const rawText = getElementText(card);
      const heading = cleanValue(getFirstText(card, ["h5"]) || rawText.split("\n")[0] || "");
      const teacher = heading.replace(/^\s*[\[【]\d+[\]】]\s*/, "").trim();
      const scheduleLines = uniqueValues(
        rawText
          .split("\n")
          .map((line) => cleanValue(line.replace(/^\s*[·•]\s*/, "")))
          .filter((line) => /(周|星期|第\d+节|\d+\s*[-~至]\s*\d+节)/.test(line) && !/(容量|志愿|选中人数|选课说明)/.test(line))
      );
      const time = scheduleLines.join("；");
      const weekMatches = time.match(new RegExp(WEEK_RANGE_RE.source, "g")) || [];

      return normalizeCourse({
        courseName: inheritedCourse?.courseName || "",
        sections: findSections(time) || inheritedCourse?.sections || "",
        credits: inheritedCourse?.credits || "",
        courseCategory: inheritedCourse?.courseCategory || "",
        courseNature: inheritedCourse?.courseNature || "",
        teacher: teacher || inheritedCourse?.teacher || "",
        weeks: uniqueValues(weekMatches).join("、") || inheritedCourse?.weeks || "",
        time: time || inheritedCourse?.time || "",
        source: "深大选课列表-展开教学班",
        rawText
      });
    }).filter((course) => isMeaningfulCourse(course, true)));
  }

  function extractDetailTableRows(root, openerCourse) {
    if (!openerCourse?.courseName) {
      return [];
    }

    const tables = queryTables(root);

    const results = [];
    for (const table of tables) {
      if (!isVisible(table)) {
        continue;
      }

      const grid = buildTableGrid(table);
      const textRows = grid.map((row) => row.map((cell) => cell?.text || ""));
      const headerIndex = findHeaderRow(textRows);
      if (headerIndex < 0) {
        continue;
      }

      const headerMap = buildHeaderMap(textRows[headerIndex]);
      const keys = new Set(Object.values(headerMap));
      if (!["teacher", "weeks", "sections", "time", "credits"].some((key) => keys.has(key))) {
        continue;
      }

      for (let rowIndex = headerIndex + 1; rowIndex < textRows.length; rowIndex += 1) {
        const row = textRows[rowIndex] || [];
        const rawText = uniqueValues(row).join("\n");
        if (!rawText || looksLikeHeaderRow(row)) {
          continue;
        }

        const context = {
          source: "课程详情表格",
          courseName: openerCourse.courseName,
          credits: openerCourse.credits || ""
        };
        for (const [column, key] of Object.entries(headerMap)) {
          const value = row[Number(column)];
          if (value) {
            context[key] = value;
          }
        }

        const course = parseCourse(rawText, context, true);
        if (isMeaningfulCourse(course, true)) {
          results.push(course);
        }
      }
    }

    return results;
  }

  function extractFromStructuredRows(root, inheritedCourse = null) {
    const results = [];
    const seenNodes = new Set();

    for (const currentRoot of getQueryableRoots(root)) {
      if (currentRoot.matches?.(".cv-course-info, .cv-teacher-item, .cv-course-card")) {
        seenNodes.add(currentRoot);
        const course = currentRoot.matches(".cv-course-card")
          ? extractSzuTeachingClassCards(currentRoot, inheritedCourse)[0]
          : parseStructuredTeachingClassNode(currentRoot, inheritedCourse);
        if (isMeaningfulCourse(course, Boolean(course?.courseName))) {
          results.push(course);
        }
      }

      const teachingNodes = currentRoot.querySelectorAll?.(".cv-course-info, .cv-teacher-item, .cv-course-card") || [];
      for (const node of teachingNodes) {
        if (seenNodes.has(node) || !isVisible(node)) {
          continue;
        }
        seenNodes.add(node);
        const course = node.matches(".cv-course-card")
          ? extractSzuTeachingClassCards(node, inheritedCourse)[0]
          : parseStructuredTeachingClassNode(node, inheritedCourse);
        if (isMeaningfulCourse(course, Boolean(course?.courseName))) {
          results.push(course);
        }
      }

      const rows = currentRoot.querySelectorAll?.(".cv-list .cv-body > .cv-row, .cv-body > .cv-row, .cv-row") || [];
      if (currentRoot.matches?.(".cv-row")) {
        seenNodes.add(currentRoot);
        const course = parseStructuredCourseRow(currentRoot, inheritedCourse);
        if (isMeaningfulCourse(course, Boolean(course?.courseName)) && !isStructuredCategoryRow(currentRoot, course)) {
          results.push(course);
        }
      }

      for (const row of rows) {
        if (seenNodes.has(row) || !isVisible(row) || row.closest(".cv-course-table")) {
          continue;
        }
        seenNodes.add(row);
        const course = parseStructuredCourseRow(row, inheritedCourse);
        if (isMeaningfulCourse(course, Boolean(course?.courseName)) && !isStructuredCategoryRow(row, course)) {
          results.push(course);
        }
      }
    }

    return dedupeCourses(results);
  }

  function parseCourseFromStructuredRow(control) {
    const teachingNode = control.closest?.(".cv-course-info, .cv-teacher-item");
    if (teachingNode) {
      const course = parseStructuredTeachingClassNode(teachingNode, null);
      return isMeaningfulCourse(course, Boolean(course?.courseName)) ? course : null;
    }

    const row = control.closest?.(".cv-row");
    if (!row) {
      return null;
    }
    const course = parseStructuredCourseRow(row, null);
    return isMeaningfulCourse(course, Boolean(course?.courseName)) && !isStructuredCategoryRow(row, course) ? course : null;
  }

  function parseStructuredCourseRow(row, inheritedCourse = null) {
    const rawText = getElementText(row);
    const courseName = cleanValue(
      getFirstText(row, [
        ".cv-course",
        ".cv-title-col",
        ".cv-school-title-col",
        "[class*='title-col']",
        "[class*='course-name']"
      ]) || inheritedCourse?.courseName || ""
    );

    const credits = cleanValue(
      getFirstText(row, [
        ".cv-credit-col",
        ".cv-school-credit-col",
        "[class*='credit-col']"
      ]) || inheritedCourse?.credits || ""
    );

    const teacher = cleanValue(
      getFirstText(row, [
        ".cv-teacher-col",
        ".cv-school-teacher-col",
        "[class*='teacher-col']"
      ]) || inheritedCourse?.teacher || ""
    );

    const time = cleanValue(
      getFirstText(row, [
        ".cv-time-col",
        "[class*='time-col']"
      ]) || inheritedCourse?.time || ""
    );

    const sections = cleanValue(
      findSections(time) ||
      getFirstText(row, [".cv-school-hours-col", "[class*='hours-col']"]) ||
      inheritedCourse?.sections ||
      ""
    );

    const weeks = cleanValue(findWeeks(time) || inheritedCourse?.weeks || "");
    const courseCategory = cleanValue(
      getFirstText(row, [".cv-type", ".cv-type-col", "[class*='type-col']"]) || inheritedCourse?.courseCategory || ""
    );
    const courseNature = cleanValue(
      getFirstText(row, [".cv-nature", "[class*='nature-col']"]) || inheritedCourse?.courseNature || ""
    );
    const source = row.closest(".public-list,.mooc-list,.school-list") ? "深大选课列表-教学班" : "深大选课列表-课程";

    return normalizeCourse({
      courseName,
      sections,
      credits,
      teacher,
      weeks,
      time,
      courseCategory,
      courseNature,
      source,
      rawText
    });
  }

  function parseStructuredTeachingClassNode(node, inheritedCourse = null) {
    const parentCourse = inheritedCourse || parseStructuredParentCourse(node);
    const teacher = cleanValue(getFirstText(node, ["h5", ".cv-info h5"]) || findTeacher(getElementText(node)));
    const place = cleanValue(getFirstText(node, [".cv-caption-text", ".cv-info .cv-caption-text"]) || "");
    const rawText = uniqueValues([parentCourse?.rawText, getElementText(node)]).join("\n---\n");

    return normalizeCourse({
      courseName: parentCourse?.courseName || "",
      sections: findSections(place) || parentCourse?.sections || "",
      credits: parentCourse?.credits || "",
      courseCategory: parentCourse?.courseCategory || "",
      courseNature: parentCourse?.courseNature || "",
      teacher: teacher || parentCourse?.teacher || "",
      weeks: findWeeks(place) || parentCourse?.weeks || "",
      time: place || parentCourse?.time || "",
      source: "深大选课详情-教学班",
      rawText
    });
  }

  function parseStructuredParentCourse(node) {
    const parent = node.closest(".cv-item,.cv-course,.cv-block") || node.parentElement;
    if (!parent) {
      return null;
    }

    const heading = cleanValue(getFirstText(parent, [":scope > h5", "h5"]) || "");
    const caption = cleanValue(getFirstText(parent, [":scope > .cv-caption-text", ".cv-caption-text"]) || "");
    const courseName = stripCourseNumber(heading);
    const creditMatch = caption.match(/(\d+(?:\.\d+)?)\s*学分/);
    const hoursMatch = caption.match(/(\d+(?:\.\d+)?)\s*学时/);

    return normalizeCourse({
      courseName,
      sections: hoursMatch ? `${hoursMatch[1]}学时` : "",
      credits: creditMatch ? creditMatch[1] : "",
      teacher: "",
      weeks: "",
      time: "",
      source: "深大选课详情-课程",
      rawText: getElementText(parent)
    });
  }

  function getFirstText(root, selectors) {
    for (const selector of selectors) {
      try {
        const node = root.querySelector?.(selector);
        const text = node ? getElementText(node) : "";
        if (text) {
          return text;
        }
      } catch {
        // Ignore unsupported selectors.
      }
    }
    return "";
  }

  function stripCourseNumber(value) {
    return cleanValue(value)
      .replace(/^[A-Z0-9_-]{4,}\s+/i, "")
      .replace(/^\d{4,}\s+/, "")
      .trim();
  }

  function isStructuredCategoryRow(row, course) {
    const name = oneLine(course?.courseName || "").replace(/\s+/g, "");
    if (isRejectedCourseName(name)) {
      return true;
    }
    const className = String(row.className || "");
    if (/cv-head|cv-foot|result-caption|search-no-more/.test(className)) {
      return true;
    }
    return !course?.courseName || !isLikelyCourseNameCell(course.courseName);
  }

  function parseCourseFromControlContext(control) {
    return parseCourseFromStructuredRow(control) || parseCourseFromTableRow(control) || parseCourseFromNearbyText(control);
  }

  function parseCourseFromTableRow(control) {
    const row = control.closest("tr");
    const table = row?.closest("table");
    if (!row || !table) {
      return null;
    }

    const rows = Array.from(table.rows || []);
    const rowIndex = rows.indexOf(row);
    if (rowIndex < 0) {
      return null;
    }

    const grid = buildTableGrid(table);
    const textRows = grid.map((gridRow) => gridRow.map((cell) => cell?.text || ""));
    const headerIndex = findHeaderRow(textRows);
    if (headerIndex < 0 || rowIndex <= headerIndex) {
      return null;
    }

    const headerMap = buildHeaderMap(textRows[headerIndex]);
    const rowValues = textRows[rowIndex] || [];
    const context = { source: "课程列表" };
    for (const [column, key] of Object.entries(headerMap)) {
      const value = rowValues[Number(column)];
      if (value) {
        context[key] = value;
      }
    }

    const rawText = uniqueValues(rowValues.filter((value) => !isDetailActionText(value))).join("\n");
    const course = parseCourse(rawText, context, true);
    return isMeaningfulCourse(course, true) ? course : null;
  }

  function parseCourseFromNearbyText(control) {
    const container = control.closest("tr,[role='row'],.cv-row,li,article,[class*='course'],[class*='Course']");
    const text = normalizeText(container?.innerText || container?.textContent || "");
    if (!text || text.length > 1200) {
      return null;
    }
    const guessedName = guessCourseNameFromContainer(container);
    const course = parseCourse(text, { source: "课程列表", courseName: guessedName }, false);
    return isMeaningfulCourse(course, Boolean(guessedName)) ? course : null;
  }

  function guessCourseNameFromContainer(container) {
    if (!isElementNode(container)) {
      return "";
    }

    const cellValues = uniqueValues(
      Array.from(container.querySelectorAll("td,th,[role='cell'],[role='gridcell']"))
        .map((cell) => getElementText(cell))
    );
    const values = cellValues.length ? cellValues : uniqueValues(getElementText(container).split("\n"));
    return values.find(isLikelyCourseNameCell) || "";
  }

  function mergeCourses(base, detail, extraText = "") {
    if (!base && !detail) {
      return null;
    }

    const merged = {
      courseName: chooseCourseName(base?.courseName, detail?.courseName),
      sections: detail?.sections || base?.sections || "",
      credits: detail?.credits || base?.credits || "",
      teacher: detail?.teacher || base?.teacher || "",
      weeks: detail?.weeks || base?.weeks || "",
      time: detail?.time || base?.time || "",
      courseCategory: detail?.courseCategory || base?.courseCategory || "",
      courseNature: detail?.courseNature || base?.courseNature || "",
      source: uniqueValues([base?.source, detail?.source, "课程详情"]).join(" + "),
      rawText: uniqueValues([base?.rawText, detail?.rawText, extraText]).join("\n---\n")
    };

    if (!merged.courseName && detail?.rawText) {
      merged.courseName = findCourseName(detail.rawText);
    }

    return merged.courseName ? merged : null;
  }

  function chooseCourseName(baseName, detailName) {
    const base = cleanValue(baseName || "");
    const detail = cleanValue(detailName || "");
    if (isProbablyCourseName(base)) {
      return base;
    }
    if (isProbablyCourseName(detail)) {
      return detail;
    }
    return base || detail;
  }

  function isProbablyCourseName(value) {
    const text = cleanValue(value);
    if (!text || text.length > 90 || isRejectedCourseName(text) || isHeaderish(text) || isDetailActionText(text)) {
      return false;
    }
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      return false;
    }
    return /[\u4e00-\u9fffA-Za-z]/.test(text);
  }

  function isDetailActionText(value) {
    const text = oneLine(value);
    return text.length <= 24 && DETAIL_CONTROL_RE.test(text);
  }

  async function closeDetailContainer(container) {
    const closeControl = findCloseControl(container);
    if (closeControl) {
      clickElementSafely(closeControl);
      await sleep(220);
    }

    if (isVisible(container)) {
      const ownerDocument = container.ownerDocument || document;
      const ownerWindow = ownerDocument.defaultView || window;
      ownerDocument.dispatchEvent(new ownerWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      ownerWindow.dispatchEvent(new ownerWindow.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await sleep(220);
    }
  }

  function findCloseControl(container) {
    const selectors = [
      "[aria-label*='关闭']",
      "[aria-label*='close' i]",
      "[title*='关闭']",
      "[title*='close' i]",
      ".el-dialog__close",
      ".ant-modal-close",
      ".ivu-modal-close",
      ".layui-layer-close",
      ".bh-dialog-close",
      ".jqx-window-close-button",
      ".ui-dialog-titlebar-close",
      ".arco-modal-close",
      ".van-popup__close-icon",
      ".close",
      "button",
      "[role='button']"
    ];
    const candidates = [];
    for (const selector of selectors) {
      try {
        candidates.push(...container.querySelectorAll(selector));
      } catch {
        // Ignore unsupported selectors.
      }
    }

    return uniqueElements(candidates).find((node) => {
      if (!isElementNode(node) || !isVisible(node)) {
        return false;
      }
      const text = getControlText(node);
      const className = String(node.className || "");
      return /close|关闭|dialog__close|modal-close|layer-close|window-close/i.test(`${text} ${className}`) || /^(×|x|关闭|取消)$/.test(text);
    });
  }

  function uniqueElements(nodes) {
    return [...new Set(nodes.filter(Boolean))];
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function buildResultFromPlainText(text, scope) {
    const courses = dedupeCourses(extractFromPlainText(text, scope));
    return {
      version: VERSION,
      scope,
      url: location.href,
      title: document.title,
      scrapedAt: new Date().toISOString(),
      count: courses.length,
      courses
    };
  }

  function extractFromTables(root) {
    const tables = queryTables(root);
    const results = [];

    for (const table of tables) {
      if (!isVisible(table) || looksLikeSearchFilterTable(table)) {
        continue;
      }
      const grid = buildTableGrid(table);
      results.push(...extractFromMappedTable(grid));
      results.push(...extractFromCalendarTable(grid));
    }

    return results;
  }

  function extractFromMappedTable(grid) {
    const textRows = grid.map((row) => row.map((cell) => cell?.text || ""));
    const headerIndex = findHeaderRow(textRows);
    if (headerIndex < 0) {
      return [];
    }

    const headerMap = buildHeaderMap(textRows[headerIndex]);
    const results = [];
    for (let rowIndex = headerIndex + 1; rowIndex < textRows.length; rowIndex += 1) {
      const row = textRows[rowIndex] || [];
      const rawText = uniqueValues(row).join("\n");
      if (!rawText || looksLikeHeaderRow(row)) {
        continue;
      }

      const context = { source: "表格" };
      for (const [column, key] of Object.entries(headerMap)) {
        const value = row[Number(column)];
        if (value) {
          context[key] = value;
        }
      }

      const course = parseCourse(rawText, context, true);
      if (isMeaningfulCourse(course, true) && !isLikelyCategoryOnlyRow(row, context)) {
        results.push(course);
      }
    }

    return results;
  }

  function extractFromCalendarTable(grid) {
    if (!grid.length) {
      return [];
    }

    const colDays = headersByColumn(grid, isWeekdayText);
    const rowDays = headersByRow(grid, isWeekdayText);
    const colPeriods = headersByColumn(grid, isPeriodText);
    const rowPeriods = headersByRow(grid, isPeriodText);
    const hasScheduleShape =
      Object.keys(colDays).length + Object.keys(rowDays).length >= 2 ||
      Object.keys(colPeriods).length + Object.keys(rowPeriods).length >= 3;

    if (!hasScheduleShape) {
      return [];
    }

    const results = [];
    for (let rowIndex = 0; rowIndex < grid.length; rowIndex += 1) {
      const row = grid[rowIndex] || [];
      for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
        const cell = row[colIndex];
        if (!cell?.isOrigin) {
          continue;
        }

        const text = cell.text;
        if (!text || text.length < 2 || text.length > 900) {
          continue;
        }
        if (isWeekdayText(text) || isPeriodText(text) || isLikelyHeaderOnly(text)) {
          continue;
        }

        const day = colDays[colIndex] || rowDays[rowIndex] || "";
        const period = rowPeriods[rowIndex] || colPeriods[colIndex] || "";
        const score = scoreTextForCourse(text) + (day ? 1 : 0) + (period ? 1 : 0);
        if (score < 2) {
          continue;
        }

        for (const block of splitCellBlocks(text)) {
          const course = parseCourse(block, { day, period, source: "课表" }, false);
          if (isMeaningfulCourse(course, false)) {
            results.push(course);
          }
        }
      }
    }

    return results;
  }

  function extractFromCards(root) {
    const selectors = [
      "li",
      "article",
      "[role='row']",
      "[class*='course' i]",
      "[id*='course' i]",
      "[class*='lesson' i]",
      "[id*='lesson' i]",
      "[class*='class' i]",
      "[id*='class' i]"
    ];

    const rootNode = isElementNode(root) ? root : null;
    const nodes = new Set(rootNode ? [rootNode] : []);
    for (const selector of selectors) {
      try {
        for (const node of root.querySelectorAll?.(selector) || []) {
          nodes.add(node);
        }
      } catch {
        // Ignore unsupported selectors on older pages.
      }
    }

    const results = [];
    for (const node of nodes) {
      if (!isElementNode(node) || node.matches("table") || !isVisible(node)) {
        continue;
      }
      if (node.closest("table") && node !== rootNode) {
        continue;
      }
      if (node.querySelector("table") || looksLikeSearchFilterNode(node)) {
        continue;
      }

      const text = normalizeText(node.innerText || node.textContent || "");
      if (text.length < 8 || text.length > 900) {
        continue;
      }
      if (node.querySelectorAll("*").length > 35 && !hasCourseClass(node)) {
        continue;
      }
      if (scoreTextForCourse(text) < 2) {
        continue;
      }

      const course = parseCourse(text, { source: "列表/卡片" }, false);
      if (isMeaningfulCourse(course, false)) {
        results.push(course);
      }
    }

    return results;
  }

  function extractFromPlainText(text, source) {
    const tabular = extractFromPlainTextTable(text, source);
    if (tabular.length) {
      return tabular;
    }

    return splitTextBlocks(text)
      .map((block) => parseCourse(block, { source }, false))
      .filter((course) => isMeaningfulCourse(course, false));
  }

  function extractFromPlainTextTable(text, source) {
    const lines = String(text)
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      return [];
    }

    const rows = lines.map((line) => {
      if (line.includes("\t")) {
        return line.split(/\t+/).map((cell) => cell.trim());
      }
      return line.split(/\s{2,}/).map((cell) => cell.trim());
    });

    if (!rows.some((row) => row.length >= 3)) {
      return [];
    }

    const headerIndex = findHeaderRow(rows);
    if (headerIndex < 0) {
      return [];
    }

    const headerMap = buildHeaderMap(rows[headerIndex]);
    const results = [];
    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const rawText = row.join("\n");
      const context = { source };
      for (const [column, key] of Object.entries(headerMap)) {
        if (row[Number(column)]) {
          context[key] = row[Number(column)];
        }
      }
      const course = parseCourse(rawText, context, true);
      if (isMeaningfulCourse(course, true)) {
        results.push(course);
      }
    }
    return results;
  }

  function parseCourse(rawText, context = {}, trusted = false) {
    const text = normalizeText(rawText);
    if (!text) {
      return null;
    }

    const course = {
      courseName: cleanValue(context.courseName || findCourseName(text)),
      sections: cleanValue(context.sections || findSections(text) || normalizePeriod(context.period || "")),
      credits: cleanValue(context.credits || findCredits(text)),
      teacher: cleanValue(context.teacher || findTeacher(text)),
      weeks: cleanValue(context.weeks || findWeeks(text)),
      time: cleanValue(context.time || findTime(text)),
      courseCategory: cleanValue(context.courseCategory || findLabeledValue(text, FIELD_ALIASES.courseCategory, 80)),
      courseNature: cleanValue(context.courseNature || findLabeledValue(text, FIELD_ALIASES.courseNature, 80)),
      source: context.source || "网页",
      rawText: text
    };

    if (!course.time && (context.day || context.period)) {
      course.time = cleanValue([context.day, normalizePeriod(context.period || "")].filter(Boolean).join(" "));
    }
    if (!course.sections && context.period) {
      course.sections = cleanValue(normalizePeriod(context.period));
    }
    if (!course.courseName && trusted) {
      course.courseName = cleanValue(inferCourseName(text));
    }

    return course;
  }

  function findCourseName(text) {
    const labeled = findLabeledValue(text, ["课程名称", "课程名", "教学班名称", "科目"], 90);
    if (labeled) {
      return labeled;
    }

    const generic = findLabeledValue(text, ["课程"], 90, true);
    if (generic && !/代码|编号|类别|性质/.test(generic)) {
      return generic;
    }

    return inferCourseName(text);
  }

  function findCredits(text) {
    const labeled = findLabeledValue(text, FIELD_ALIASES.credits, 24);
    if (labeled) {
      const match = labeled.match(/\d+(?:\.\d+)?/);
      return match ? match[0] : labeled;
    }
    const labelMatch = text.match(/学分\s*[:：]?\s*(\d+(?:\.\d+)?)/);
    if (labelMatch) {
      return labelMatch[1];
    }
    const match = text.match(/(\d+(?:\.\d+)?)\s*学分/);
    return match ? match[1] : "";
  }

  function findTeacher(text) {
    const labeled = findLabeledValue(text, FIELD_ALIASES.teacher, 80);
    if (labeled) {
      return labeled;
    }

    const line = text
      .split("\n")
      .map((item) => item.trim())
      .find((item) => /(老师|教师|教授|讲师)/.test(item) && item.length <= 80);
    if (!line) {
      return "";
    }
    return line.replace(/^(任课教师|授课教师|主讲教师|任课老师|授课老师|教师姓名|教师|老师)\s*[:：]?\s*/, "");
  }

  function findWeeks(text) {
    const labeled = findLabeledValue(text, FIELD_ALIASES.weeks, 80);
    if (labeled) {
      return labeled;
    }
    const labelMatch = text.match(/(?:周次|周数)\s*[:：]?\s*([^\n,，;；|]+)/);
    if (labelMatch) {
      return labelMatch[1].trim();
    }
    const match = text.match(WEEK_RANGE_RE);
    return match ? match[0] : "";
  }

  function findSections(text) {
    const labeled = findLabeledValue(text, FIELD_ALIASES.sections, 80);
    if (labeled) {
      return labeled;
    }
    const labelMatch = text.match(/(?:节次|节数|学时)\s*[:：]?\s*([^\n,，;；|]+)/);
    if (labelMatch) {
      return labelMatch[1].trim();
    }
    const matches = text.match(SECTION_GLOBAL_RE);
    return matches ? uniqueValues(matches).join("、") : "";
  }

  function findTime(text) {
    const labeled = findLabeledValue(text, FIELD_ALIASES.time, 120);
    if (labeled) {
      return labeled;
    }

    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    const timeLine = lines.find((line) => {
      if (line.length > 140) {
        return false;
      }
      return WEEKDAY_RE.test(line) || TIME_RANGE_RE.test(line) || SECTION_RE.test(line);
    });

    return timeLine || "";
  }

  function inferCourseName(text) {
    const lines = text.split("\n").map((line) => cleanValue(line)).filter(Boolean);
    const labeled = lines
      .map((line) => findLabeledValue(line, ["课程名称", "课程名", "教学班名称", "科目"], 90))
      .find(Boolean);
    if (labeled) {
      return labeled;
    }

    for (const line of lines) {
      const value = cleanValue(line);
      if (!value || value.length > 90 || !isLikelyCourseNameCell(value)) {
        continue;
      }
      return value;
    }

    return "";
  }

  function findLabeledValue(text, labels, maxLength = 120, requireColon = false) {
    const lines = normalizeText(text).split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const label of labels) {
        const escaped = escapeRegExp(label);
        const separator = requireColon ? "\\s*[:：]\\s*" : "\\s*[:：]?\\s*";
        const regex = new RegExp(`${escaped}${separator}([^\\n,，;；|]+)`, "i");
        const match = line.match(regex);
        if (match?.[1]) {
          return match[1].trim().slice(0, maxLength);
        }
        const labelOnlyRegex = new RegExp(`^${escaped}\\s*[:：]?\\s*$`, "i");
        if (labelOnlyRegex.test(line)) {
          const next = lines[index + 1]?.trim();
          if (next && !fieldKeyForHeader(next) && !isDetailActionText(next)) {
            return next.slice(0, maxLength);
          }
        }
      }
    }
    return "";
  }

  function isMeaningfulCourse(course, trusted) {
    if (!course?.courseName) {
      return false;
    }
    if (isRejectedCourseName(course.courseName)) {
      return false;
    }
    if (isHeaderish(course.courseName) || isDetailActionText(course.courseName) || isLikelyNonCourseCell(course.courseName)) {
      return false;
    }
    if (trusted) {
      return true;
    }
    return Boolean(course.teacher || course.weeks || course.time || course.sections || course.credits || scoreTextForCourse(course.rawText) >= 3);
  }

  function scoreTextForCourse(text) {
    const value = normalizeText(text);
    let score = 0;
    if (/(课程名称|课程名|教学班名称|课程|科目)/.test(value)) score += 2;
    if (/(任课教师|授课教师|主讲教师|任课老师|授课老师|教师姓名|教师|老师)/.test(value)) score += 1;
    if (/学分/.test(value)) score += 1;
    if (WEEK_RANGE_RE.test(value) || /(授课周次|上课周次|周次|周数|上课周|教学周)/.test(value)) score += 1;
    if (SECTION_RE.test(value) || /(节次|节数|课节|总学时|学时)/.test(value)) score += 1;
    if (WEEKDAY_RE.test(value) || TIME_RANGE_RE.test(value) || /(上课星期|上课时间|上课安排)/.test(value)) score += 1;
    return score;
  }

  function buildTableGrid(table) {
    const grid = [];
    const rows = Array.from(table.rows || []);
    rows.forEach((row, rowIndex) => {
      grid[rowIndex] ||= [];
      let colIndex = 0;
      for (const cell of Array.from(row.cells || [])) {
        while (grid[rowIndex][colIndex]) {
          colIndex += 1;
        }

        const text = normalizeText(cell.innerText || cell.textContent || "");
        const rowSpan = Math.max(1, Number(cell.rowSpan) || 1);
        const colSpan = Math.max(1, Number(cell.colSpan) || 1);
        for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
          grid[rowIndex + rowOffset] ||= [];
          for (let colOffset = 0; colOffset < colSpan; colOffset += 1) {
            grid[rowIndex + rowOffset][colIndex + colOffset] = {
              text,
              cell,
              isOrigin: rowOffset === 0 && colOffset === 0
            };
          }
        }
        colIndex += colSpan;
      }
    });
    return grid;
  }

  function findHeaderRow(rows) {
    const limit = Math.min(rows.length, 8);
    for (let index = 0; index < limit; index += 1) {
      const keys = new Set(rows[index].map(fieldKeyForHeader).filter(Boolean));
      if ((keys.has("courseName") && keys.size >= 2) || keys.size >= 3) {
        return index;
      }
    }
    return -1;
  }

  function buildHeaderMap(headerRow) {
    const map = {};
    headerRow.forEach((text, index) => {
      const key = fieldKeyForHeader(text);
      if (key && !Object.values(map).includes(key)) {
        map[index] = key;
      }
    });
    return map;
  }

  function fieldKeyForHeader(text) {
    const value = oneLine(text).replace(/\s+/g, "");
    if (!value || value.length > 28 || isWeekdayText(value) || isPeriodText(value)) {
      return "";
    }
    if (/课程名称|课程名|教学班名称|教学班|科目|^课程$|^名称$/.test(value)) return "courseName";
    if (/课程学分|学分/.test(value)) return "credits";
    if (/任课教师|授课教师|主讲教师|任课老师|授课老师|教师姓名|教师|老师/.test(value)) return "teacher";
    if (/起止周|授课周次|上课周次|上课周|教学周|周次|周数/.test(value)) return "weeks";
    if (/上课节次|上课节数|节次|节数|课节|总学时|学时/.test(value)) return "sections";
    if (/上课时间|上课安排|上课日期|上课星期|时间|星期/.test(value)) return "time";
    if (/课程类别|课程类型|^类别$/.test(value)) return "courseCategory";
    if (/课程性质|^性质$/.test(value)) return "courseNature";
    return "";
  }

  function looksLikeHeaderRow(row) {
    const keys = new Set(row.map(fieldKeyForHeader).filter(Boolean));
    return keys.size >= 2;
  }

  function headersByColumn(grid, predicate) {
    const headers = {};
    const maxRows = Math.min(grid.length, 4);
    for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
      const row = grid[rowIndex] || [];
      for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
        const text = oneLine(row[colIndex]?.text || "");
        if (!headers[colIndex] && predicate(text)) {
          headers[colIndex] = text;
        }
      }
    }
    return headers;
  }

  function headersByRow(grid, predicate) {
    const headers = {};
    for (let rowIndex = 0; rowIndex < grid.length; rowIndex += 1) {
      const row = grid[rowIndex] || [];
      const maxCols = Math.min(row.length, 4);
      for (let colIndex = 0; colIndex < maxCols; colIndex += 1) {
        const text = oneLine(row[colIndex]?.text || "");
        if (!headers[rowIndex] && predicate(text)) {
          headers[rowIndex] = text;
        }
      }
    }
    return headers;
  }

  function splitCellBlocks(text) {
    const blocks = splitTextBlocks(text);
    if (blocks.length > 1) {
      return blocks;
    }
    return [normalizeText(text)].filter(Boolean);
  }

  function splitTextBlocks(text) {
    const raw = String(text).replace(/\r/g, "\n").replace(/\u00a0/g, " ");
    let blocks = raw
      .split(/\n\s*\n|[-=]{3,}/)
      .map(normalizeText)
      .filter((block) => block.length >= 4);

    if (blocks.length === 1 && blocks[0].length > 350) {
      blocks = raw
        .split("\n")
        .map(normalizeText)
        .filter((line) => line.length >= 4 && scoreTextForCourse(line) >= 2);
    }

    return blocks;
  }

  function dedupeCourses(courses) {
    const seen = new Set();
    const result = [];
    for (const course of courses) {
      if (!course?.courseName) {
        continue;
      }
      const normalized = normalizeCourse(course);
      const key = [
        normalized.courseName,
        normalized.teacher,
        normalized.weeks,
        normalized.time,
        normalized.sections,
        normalized.credits
      ]
        .join("|")
        .toLowerCase()
        .replace(/\s+/g, "");
      if (!seen.has(key)) {
        seen.add(key);
        result.push(normalized);
      }
    }
    return result;
  }

  function normalizeCourse(course) {
    return {
      courseName: cleanValue(course.courseName),
      courseNumber: cleanValue(course.courseNumber),
      courseTotalNumber: cleanValue(course.courseTotalNumber),
      sections: cleanValue(course.sections),
      credits: cleanValue(course.credits),
      teacher: cleanValue(course.teacher),
      weeks: cleanValue(course.weeks),
      time: cleanValue(course.time),
      courseCategory: cleanValue(course.courseCategory),
      courseNature: cleanValue(course.courseNature),
      source: cleanValue(course.source),
      rawText: normalizeText(course.rawText || "")
    };
  }

  function cleanValue(value) {
    let text = oneLine(value);
    for (const label of ALL_LABELS) {
      text = text.replace(new RegExp(`^${escapeRegExp(label)}\\s*[:：]?\\s*`, "i"), "");
    }
    return text.replace(/\s+/g, " ").trim();
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function oneLine(value) {
    return normalizeText(value).replace(/\n+/g, " ").trim();
  }

  function uniqueValues(values) {
    return [...new Set(values.map((value) => oneLine(value)).filter(Boolean))];
  }

  function isWeekdayText(text) {
    const value = oneLine(text);
    return value.length <= 12 && WEEKDAY_RE.test(value);
  }

  function isPeriodText(text) {
    const value = oneLine(text);
    if (!value || value.length > 24) {
      return false;
    }
    return /^(上午|下午|晚上|早上|中午)$/.test(value) || /^第?\s*\d{1,2}\s*(?:[-~至到\u2013\u2014]\s*\d{1,2})?\s*节?$/.test(value);
  }

  function isLikelyHeaderOnly(text) {
    return /^(课程|课程名称|星期|节次|时间|上午|下午|晚上|教师|老师|周次|周数)$/.test(oneLine(text));
  }

  function isHeaderish(text) {
    return /(课程名称|课程名|任课教师|授课教师|主讲教师|学分|周次|周数|节次|节数)/.test(oneLine(text));
  }

  function isRejectedCourseName(value) {
    const text = oneLine(value);
    const compactText = text.replace(/\s+/g, "");
    if (!text) {
      return true;
    }
    return /^(本班课程|方案内课程|方案外课程|校公选课|必修未通过课程.*|体育课程|辅修专业及辅修学士学位课程|MOOC|全校课程选课校验|退出|EXIT|TOP|上一页|下一页|版权信息|--请选择--)$/.test(compactText);
  }

  function isLikelyCourseNameCell(value) {
    const text = oneLine(value);
    if (!text || text.length > 90 || isRejectedCourseName(text) || isHeaderish(text) || isDetailActionText(text) || isLikelyNonCourseCell(text)) {
      return false;
    }
    if (/^\d+(?:\.\d+)?$/.test(text) || /^[A-Z0-9_-]{4,}$/i.test(text)) {
      return false;
    }
    if (/(课程代码|课程编号|课程序号|课程号|课程总号|课程类别|课程性质|可选班级数|开课单位|学分|教师|老师|周次|周数|上课|时间|星期|节次|节数|地点|教室|校区|容量|备注|考试|班级|学院)/.test(text)) {
      return false;
    }
    return /[\u4e00-\u9fffA-Za-z]/.test(text);
  }

  function isLikelyNonCourseCell(value) {
    const text = oneLine(value).replace(/\s+/g, "");
    return /^(必修|选修|限选|任选|公共必修|公共选修|专业必修|专业选修|基本通识课|核心通识课|一般通识课|通识课|公共课|专业课|学科基础课|专业核心课|实践教学|实验课|理论课|考试|考查|正常|已选|未选|可选|不可选|冲突|不冲突|是|否|无|有)$/.test(text);
  }

  function isLikelyCategoryOnlyRow(row, context) {
    const name = oneLine(context.courseName || "").replace(/\s+/g, "");
    if (isRejectedCourseName(name)) {
      return true;
    }
    const nonEmpty = uniqueValues(row);
    if (nonEmpty.length <= 2 && nonEmpty.some((value) => isRejectedCourseName(value))) {
      return true;
    }
    return false;
  }

  function normalizePeriod(value) {
    const text = oneLine(value);
    if (!text) {
      return "";
    }
    if (/节/.test(text) || /上午|下午|晚上|早上|中午/.test(text)) {
      return text;
    }
    if (/^\d{1,2}\s*(?:[-~至到\u2013\u2014]\s*\d{1,2})?$/.test(text)) {
      return `第${text}节`;
    }
    return text;
  }

  function hasCourseClass(node) {
    const value = `${node.className || ""} ${node.id || ""}`.toLowerCase();
    return /course|lesson|class|kc|kecheng/.test(value);
  }

  function isVisible(element) {
    if (!isElementNode(element) || typeof element.getBoundingClientRect !== "function") {
      return false;
    }
    const view = element.ownerDocument?.defaultView || window;
    const style = view.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isElementNode(node) {
    return Boolean(node && node.nodeType === 1 && typeof node.querySelectorAll === "function");
  }

  function isTableElement(node) {
    return isElementNode(node) && String(node.tagName || "").toLowerCase() === "table";
  }

  function isConnectedElement(element) {
    return Boolean(element?.isConnected || element?.ownerDocument?.contains?.(element));
  }

  function getQueryableRoots(root) {
    const roots = [];
    const seen = new Set();

    const visit = (node, depth = 0) => {
      if (!isElementNode(node) || seen.has(node) || depth > 2) {
        return;
      }
      seen.add(node);
      roots.push(node);

      for (const frame of node.querySelectorAll?.("iframe") || []) {
        const body = getFrameBody(frame);
        if (body) {
          visit(body, depth + 1);
        }
      }
    };

    visit(root);
    return roots;
  }

  function getFrameBody(frame) {
    try {
      return frame.contentDocument?.body || frame.contentWindow?.document?.body || null;
    } catch {
      return null;
    }
  }

  function getElementText(element) {
    const chunks = [];
    const seen = new Set();
    for (const root of getQueryableRoots(element)) {
      const text = normalizeText(root.innerText || root.textContent || "");
      if (text && !seen.has(text)) {
        seen.add(text);
        chunks.push(text);
      }
    }
    return normalizeText(chunks.join("\n"));
  }

  function queryTables(root) {
    const tables = [];
    for (const currentRoot of getQueryableRoots(root)) {
      if (isTableElement(currentRoot)) {
        tables.push(currentRoot);
      }
      tables.push(...(currentRoot.querySelectorAll?.("table") || []));
    }
    return uniqueElements(tables);
  }

  function looksLikeSearchFilterTable(table) {
    const text = normalizeText(table.innerText || table.textContent || "");
    const formSignals = (text.match(/--请选择--|是否冲突|是否Mooc|开始节次|结束节次|课程总号|查询|搜索|重置|筛选/g) || []).length;
    const resultSignals = (text.match(/课程号|课程选号|课程名称|可选班级数|任课教师|授课教师|周次|上课时间|上课安排/g) || []).length;
    return formSignals >= 3 && resultSignals < 4;
  }

  function looksLikeSearchFilterNode(node) {
    const text = normalizeText(node.innerText || node.textContent || "");
    const filterMatches = (text.match(/--请选择--|是否冲突|开课单位|是否Mooc|课程性质|课程类别|文\s*\/\s*理|开始节次|结束节次|课程总号|查询|搜索/g) || []).length;
    return filterMatches >= 3;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async function saveResult(result) {
    const hostKey = resultKeyForHost(location.host);
    await storageSet({
      [LAST_RESULT_KEY]: result,
      ...(hostKey ? { [hostKey]: result } : {})
    });
  }

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(items) {
    return new Promise((resolve) => chrome.storage.local.set(items, resolve));
  }

  function resultKeyForHost(host) {
    return host ? `courseScraper:last:${host}` : "";
  }

  async function checkAutoScrape() {
    if (!location.host) {
      return;
    }
    const data = await storageGet([AUTO_HOSTS_KEY]);
    if (!data[AUTO_HOSTS_KEY]?.[location.host]) {
      return;
    }

    const result = await expandDetailsAndBuildResult(document.body, "自动展开爬取", { quiet: true });
    await saveResult(result);
    notifyPopup(result);
  }

  function notifyProgress(text, tone = "") {
    try {
      chrome.runtime.sendMessage(
        {
          source: CONTENT_SOURCE,
          type: "SCRAPE_PROGRESS",
          text,
          tone
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch {
      // The popup may be closed.
    }
  }

  function notifyError(error) {
    try {
      chrome.runtime.sendMessage(
        {
          source: CONTENT_SOURCE,
          type: "SCRAPE_ERROR",
          error
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch {
      // The popup may be closed.
    }
  }

  function notifyPopup(result) {
    try {
      chrome.runtime.sendMessage(
        {
          source: CONTENT_SOURCE,
          type: "SCRAPE_RESULT",
          result
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch {
      // The popup may be closed. The result is already saved in storage.
    }
  }

  function notifyPreviewDone(count) {
    try {
      chrome.runtime.sendMessage(
        {
          source: CONTENT_SOURCE,
          type: "PREVIEW_DONE",
          count
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch {
      // The popup may be closed while the page preview remains visible.
    }
  }

  function startPicker() {
    stopPicker();

    const highlight = document.createElement("div");
    highlight.id = "course-scraper-highlight";
    Object.assign(highlight.style, {
      position: "fixed",
      zIndex: "2147483646",
      pointerEvents: "none",
      border: "2px solid #1463ff",
      background: "rgba(20, 99, 255, 0.10)",
      boxShadow: "0 0 0 99999px rgba(15, 23, 42, 0.10)",
      borderRadius: "6px",
      display: "none"
    });

    const tip = document.createElement("div");
    tip.id = "course-scraper-tip";
    tip.textContent = "点击要爬取的课程区域，Esc 取消";
    Object.assign(tip.style, {
      position: "fixed",
      left: "16px",
      bottom: "16px",
      zIndex: "2147483647",
      padding: "8px 10px",
      borderRadius: "7px",
      background: "#172033",
      color: "#fff",
      font: "13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      boxShadow: "0 8px 28px rgba(0, 0, 0, 0.24)"
    });

    document.documentElement.append(highlight, tip);

    picker = {
      highlight,
      tip,
      target: null,
      move: (event) => {
        const rawTarget = document.elementFromPoint(event.clientX, event.clientY);
        const target = pickUsefulElement(rawTarget);
        picker.target = target;
        updateHighlight(highlight, target);
      },
      click: async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const target = picker.target || pickUsefulElement(event.target);
        stopPicker();

        const result = buildResult(target, "框选区域");
        await saveResult(result);
        notifyPopup(result);
        showToast(`框选爬取完成：${result.courses.length} 门课程`);
      },
      keydown: (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          stopPicker();
          showToast("已取消框选");
        }
      }
    };

    document.addEventListener("mousemove", picker.move, true);
    document.addEventListener("click", picker.click, true);
    document.addEventListener("keydown", picker.keydown, true);
  }

  function stopPicker() {
    if (!picker) {
      return;
    }
    document.removeEventListener("mousemove", picker.move, true);
    document.removeEventListener("click", picker.click, true);
    document.removeEventListener("keydown", picker.keydown, true);
    picker.highlight.remove();
    picker.tip.remove();
    picker = null;
  }

  function pickUsefulElement(rawTarget) {
    let node = isElementNode(rawTarget) ? rawTarget : document.body;
    if (node.id === "course-scraper-highlight" || node.id === "course-scraper-tip") {
      node = document.body;
    }

    let best = node;
    let current = node;
    let depth = 0;
    while (current && current !== document.body && depth < 8) {
      const text = normalizeText(current.innerText || current.textContent || "");
      const matchesUsefulShape = current.matches?.(
        "table, tbody, tr, td, th, li, article, section, main, [role='row'], [class*='course' i], [id*='course' i], [class*='lesson' i], [id*='lesson' i]"
      );

      if (matchesUsefulShape && text.length >= 4 && text.length <= 8000) {
        best = current;
        if (current.matches("table, section, article, main") || scoreTextForCourse(text) >= 2) {
          break;
        }
      }

      current = current.parentElement;
      depth += 1;
    }

    return best || document.body;
  }

  function updateHighlight(highlight, target) {
    if (!target || !isElementNode(target)) {
      highlight.style.display = "none";
      return;
    }
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      highlight.style.display = "none";
      return;
    }

    Object.assign(highlight.style, {
      display: "block",
      left: `${Math.max(0, rect.left)}px`,
      top: `${Math.max(0, rect.top)}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
  }

  function showToast(text) {
    const old = document.getElementById("course-scraper-toast");
    old?.remove();

    const toast = document.createElement("div");
    toast.id = "course-scraper-toast";
    toast.textContent = text;
    Object.assign(toast.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "2147483647",
      maxWidth: "320px",
      padding: "9px 11px",
      borderRadius: "7px",
      background: "#0a7a50",
      color: "#ffffff",
      font: "13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      boxShadow: "0 8px 28px rgba(0, 0, 0, 0.24)"
    });
    document.documentElement.append(toast);
    setTimeout(() => toast.remove(), 2600);
  }
})();
