const LAST_RESULT_KEY = "courseScraper:lastResult";
const AUTO_HOSTS_KEY = "courseScraper:autoHosts:v2";
const FILTER_PREFS_KEY = "courseScraper:categoryFilters";
const POPUP_SOURCE = "course-scraper-popup:0.7.5";

const state = {
  activeTabId: null,
  currentUrl: "",
  currentHost: "",
  result: null,
  planResult: null,
  activePlanIndex: -1,
  exportMode: "detailed",
  excludedCategories: new Set(),
  deletedCourseKeys: new Set(),
  courseGroups: [],
  selectedGroupKeys: new Set(),
  pendingAsyncScrape: false,
  calendarPreviewOpen: false
};

const fields = [
  "courseName",
  "sections",
  "credits",
  "teacher",
  "weeks",
  "time"
];


const labels = {
  courseName: "课程名称",
  sections: "节数",
  credits: "学分",
  teacher: "老师",
  weeks: "周数",
  time: "时间",
  courseCategory: "课程类别",
  courseNature: "课程性质",
  source: "来源",
  rawText: "原文"
};

const els = {
  hostLabel: document.getElementById("hostLabel"),
  autoToggle: document.getElementById("autoToggle"),
  scanCourseGroups: document.getElementById("scanCourseGroups"),
  scanAllPages: document.getElementById("scanAllPages"),
  expandAndScrape: document.getElementById("expandAndScrape"),
  expandAllPages: document.getElementById("expandAllPages"),
  crawlPageLimit: document.getElementById("crawlPageLimit"),
  crawlDelaySeconds: document.getElementById("crawlDelaySeconds"),
  crawlCourseRegex: document.getElementById("crawlCourseRegex"),
  status: document.getElementById("status"),
  countLabel: document.getElementById("countLabel"),
  creditLabel: document.getElementById("creditLabel"),
  timeLabel: document.getElementById("timeLabel"),
  clearAllCache: document.getElementById("clearAllCache"),
  courseRows: document.getElementById("courseRows"),
  copyCsv: document.getElementById("copyCsv"),
  copyJson: document.getElementById("copyJson"),
  downloadCsv: document.getElementById("downloadCsv"),
  downloadJson: document.getElementById("downloadJson"),
  downloadAllPlans: document.getElementById("downloadAllPlans"),
  strategySelect: document.getElementById("strategySelect"),
  planningMode: document.getElementById("planningMode"),
  advancedOptions: document.getElementById("advancedOptions"),
  generatePlans: document.getElementById("generatePlans"),
  planSelect: document.getElementById("planSelect"),
  planMeta: document.getElementById("planMeta"),
  maxDaysSelect: document.getElementById("maxDaysSelect"),
  earlyPolicySelect: document.getElementById("earlyPolicySelect"),
  eveningPolicySelect: document.getElementById("eveningPolicySelect"),
  acceptEveningToggle: document.getElementById("acceptEveningToggle"),
  showCalendar: document.getElementById("showCalendar"),
  showCandidates: document.getElementById("showCandidates"),
  resetCourseEdits: document.getElementById("resetCourseEdits"),
  filterPublicElective: document.getElementById("filterPublicElective"),
  filterPublicRequired: document.getElementById("filterPublicRequired"),
  filterProfessionalElective: document.getElementById("filterProfessionalElective"),
  filterProfessionalRequired: document.getElementById("filterProfessionalRequired"),
  filterSports: document.getElementById("filterSports"),
  filterMooc: document.getElementById("filterMooc"),
  groupPicker: document.getElementById("groupPicker"),
  groupList: document.getElementById("groupList"),
  groupCount: document.getElementById("groupCount"),
  selectedGroupCount: document.getElementById("selectedGroupCount"),
  selectAllGroups: document.getElementById("selectAllGroups"),
  clearAllGroups: document.getElementById("clearAllGroups"),
  clearGroupCache: document.getElementById("clearGroupCache")
};

const categoryFilters = [
  { key: "public-elective", element: els.filterPublicElective },
  { key: "public-required", element: els.filterPublicRequired },
  { key: "professional-elective", element: els.filterProfessionalElective },
  { key: "professional-required", element: els.filterProfessionalRequired },
  { key: "sports", element: els.filterSports },
  { key: "mooc", element: els.filterMooc }
];

document.addEventListener("DOMContentLoaded", init);

els.expandAndScrape.addEventListener("click", async () => {
  if (!state.selectedGroupKeys.size) {
    setStatus("请先读取并勾选至少一个课程大类", "warn");
    return;
  }
  await runScrape("EXPAND_SELECTED_COURSES", {
    selectedGroupKeys: [...state.selectedGroupKeys]
  });
});

els.expandAllPages.addEventListener("click", async () => {
  if (!state.selectedGroupKeys.size) {
    setStatus("请先读取并勾选至少一个课程大类", "warn");
    return;
  }
  await runScrape("EXPAND_SELECTED_COURSES_ALL_PAGES", {
    selectedGroupKeys: [...state.selectedGroupKeys],
    ...getCrawlOptions()
  });
});

els.scanCourseGroups.addEventListener("click", scanCourseGroups);
els.scanAllPages.addEventListener("click", scanAllPages);

els.selectAllGroups.addEventListener("click", () => {
  state.selectedGroupKeys = new Set(getVisibleCourseGroups().map((group) => group.key));
  renderCourseGroups();
  persistGroupCache();
  refreshAfterGroupSelection();
});

els.clearAllGroups.addEventListener("click", () => {
  state.selectedGroupKeys.clear();
  renderCourseGroups();
  persistGroupCache();
  refreshAfterGroupSelection();
});

els.clearGroupCache.addEventListener("click", async () => {
  state.courseGroups = [];
  state.selectedGroupKeys.clear();
  await persistGroupCache();
  renderCourseGroups();
  els.groupPicker.hidden = true;
  setStatus("已清空累计课程大类列表", "ok");
});

els.showCalendar.addEventListener("click", async () => {
  if (state.activePlanIndex < 0) {
    setStatus("请先生成并选择一个排课方案", "warn");
    return;
  }
  const courses = getVisibleCourses();
  if (!courses.length) {
    setStatus("当前排课方案没有可预览的课程", "warn");
    return;
  }
  try {
    const response = await sendToActiveTab("SHOW_CALENDAR", { courses: buildCalendarCourses(courses) });
    if (!response?.ok) {
      throw new Error(response?.error || "无法生成网页课程表");
    }
    state.calendarPreviewOpen = true;
    const courseNames = [...new Set(courses.map((course) => String(course.courseName || "").trim()).filter(Boolean))];
    setStatus(`已在网页中生成 ${courseNames.length} 门课程的可视化课表：${courseNames.join("、")}`, "ok");
  } catch (error) {
    setStatus(error.message || "无法生成网页课程表", "warn");
  }
});

els.clearAllCache.addEventListener("click", clearAllCourseCache);

els.autoToggle.addEventListener("change", async () => {
  const enabled = els.autoToggle.checked;
  const data = await storageGet([AUTO_HOSTS_KEY]);
  const autoHosts = data[AUTO_HOSTS_KEY] || {};
  if (state.currentHost) {
    autoHosts[state.currentHost] = enabled;
  }
  await storageSet({ [AUTO_HOSTS_KEY]: autoHosts });

  try {
    await sendToActiveTab("AUTO_STATE_CHANGED", { enabled });
  } catch {
    // Some browser pages cannot receive content-script messages.
  }

  setStatus(enabled ? "已开启当前网站自动爬取" : "已关闭当前网站自动爬取", "ok");
});

els.copyCsv.addEventListener("click", async () => {
  await copyText(toCsv(getVisibleCourses(), state.exportMode), `${exportModeLabel()} CSV 已复制`);
});

els.copyJson.addEventListener("click", async () => {
  await copyText(JSON.stringify(toExportCourses(getVisibleCourses(), state.exportMode), null, 2), `${exportModeLabel()} JSON 已复制`);
});

els.downloadCsv.addEventListener("click", () => {
  downloadText(`${fileStem()}.csv`, "\ufeff" + toCsv(getVisibleCourses(), state.exportMode), "text/csv;charset=utf-8");
});

els.downloadJson.addEventListener("click", () => {
  downloadText(
    `${fileStem()}.json`,
    JSON.stringify(toExportCourses(getVisibleCourses(), state.exportMode), null, 2),
    "application/json;charset=utf-8"
  );
});

els.downloadAllPlans.addEventListener("click", () => {
  if (!state.planResult?.plans?.length) {
    return;
  }
  const payload = {
    strategy: state.planResult.strategy,
    generatedAt: state.planResult.generatedAt,
    plans: state.planResult.plans.map((plan) => ({
      id: plan.id,
      label: plan.label,
      metrics: plan.metrics,
      courses: toExportCourses(plan.courses, state.exportMode)
    }))
  };
  downloadText(
    `${fileStem("all-plans")}.json`,
    JSON.stringify(payload, null, 2),
    "application/json;charset=utf-8"
  );
});

els.generatePlans.addEventListener("click", generateSchedulePlans);

els.planningMode.addEventListener("change", () => {
  togglePlanningMode();
  persistPlanSession();
});

for (const input of [els.strategySelect, els.maxDaysSelect, els.earlyPolicySelect, els.eveningPolicySelect, els.acceptEveningToggle]) {
  input.addEventListener("change", persistPlanSession);
}

els.planSelect.addEventListener("change", () => {
  const index = Number(els.planSelect.value);
  if (Number.isInteger(index) && index >= 0) {
    showPlan(index);
  }
});

els.showCandidates.addEventListener("click", () => {
  state.activePlanIndex = -1;
  renderCurrentView();
  els.showCandidates.disabled = true;
  els.showCalendar.disabled = true;
  persistPlanSession();
  setStatus(`已显示 ${getCandidateCourses().length} 条候选教学班`, "ok");
});

for (const filter of categoryFilters) {
  filter.element.addEventListener("change", async () => {
    if (filter.element.checked) {
      state.excludedCategories.add(filter.key);
    } else {
      state.excludedCategories.delete(filter.key);
    }
    await persistCategoryFilters();
    removeHiddenGroupSelections();
    renderCourseGroups();
    persistGroupCache();
    refreshAfterCourseEdit("课程类别筛选已更新");
  });
}

els.resetCourseEdits.addEventListener("click", async () => {
  state.excludedCategories.clear();
  state.deletedCourseKeys.clear();
  for (const filter of categoryFilters) {
    filter.element.checked = false;
  }
  await Promise.all([
    storageSet({ [FILTER_PREFS_KEY]: [] }),
    storageSet({ [deletedCoursesKeyForHost(state.currentHost)]: [] })
  ]);
  renderCourseGroups();
  refreshAfterCourseEdit("已恢复全部课程和类别");
});

for (const input of document.querySelectorAll("input[name='exportMode']")) {
  input.addEventListener("change", () => {
    if (input.checked) {
      state.exportMode = input.value;
      setStatus(`已切换为${exportModeLabel()}导出`, "ok");
    }
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.source !== "course-scraper-content") {
    return;
  }

  if (message.type === "SCRAPE_RESULT" && message.result) {
    state.pendingAsyncScrape = false;
    setBusy(false);
    updateResult(message.result);
  }

  if (message.type === "SCRAPE_PROGRESS") {
    setStatus(message.text || "正在展开课程详情...", message.tone || "");
  }

  if (message.type === "PREVIEW_DONE") {
    state.pendingAsyncScrape = false;
    setBusy(false);
    setStatus(`网页预览已生成，共 ${message.count || 0} 个教学班`, "ok");
  }

  if (message.type === "SCRAPE_ERROR") {
    state.pendingAsyncScrape = false;
    setBusy(false);
    setStatus(message.error || "展开爬取失败，请刷新页面后重试。", "warn");
  }
});

async function init() {
  const [tab] = await queryTabs({ active: true, currentWindow: true });
  state.activeTabId = tab?.id ?? null;
  state.currentUrl = tab?.url || "";
  state.currentHost = getHost(state.currentUrl);
  els.hostLabel.textContent = state.currentHost || "当前网页";
  togglePlanningMode();

  const hostKey = resultKeyForHost(state.currentHost);
  const deletedKey = deletedCoursesKeyForHost(state.currentHost);
  const groupKey = groupCacheKeyForHost(state.currentHost);
  const planKey = planCacheKeyForHost(state.currentHost);
  const data = await storageGet([AUTO_HOSTS_KEY, FILTER_PREFS_KEY, LAST_RESULT_KEY, hostKey, deletedKey, groupKey, planKey]);
  els.autoToggle.checked = data[AUTO_HOSTS_KEY]?.[state.currentHost] === true;
  state.excludedCategories = new Set(data[FILTER_PREFS_KEY] || []);
  state.deletedCourseKeys = new Set(data[deletedKey] || []);
  state.courseGroups = Array.isArray(data[groupKey]?.groups) ? data[groupKey].groups : [];
  state.selectedGroupKeys = new Set(data[groupKey]?.selectedGroupKeys || []);
  for (const filter of categoryFilters) {
    filter.element.checked = state.excludedCategories.has(filter.key);
  }
  removeHiddenGroupSelections();
  if (state.courseGroups.length) {
    renderCourseGroups();
    els.groupPicker.hidden = false;
  }

  const hostResult = hostKey ? data[hostKey] : null;
  const lastResult = data[LAST_RESULT_KEY];
  const result = resultBelongsHere(hostResult) ? hostResult : resultBelongsHere(lastResult) ? lastResult : null;
  if (result) {
    updateResult(result, false, true);
    restorePlanSession(data[planKey]);
  }
}

async function runScrape(type, payload = {}) {
  setBusy(true);
  state.pendingAsyncScrape = false;
  const statusText = {
    EXPAND_SELECTED_COURSES: "正在展开已勾选大类并爬取教学班...",
    EXPAND_SELECTED_COURSES_ALL_PAGES: "正在自动翻页展开并爬取已勾选大类...",
    PREVIEW_SELECTED_COURSES: "正在展开已勾选大类并生成网页预览..."
  }[type] || "正在处理...";
  setStatus(statusText, "");
  try {
    const response = await sendToActiveTab(type, payload);
    if (!response?.ok) {
      throw new Error(response?.error || "爬取失败");
    }
    if (response.accepted) {
      state.pendingAsyncScrape = true;
      setStatus(response.message || statusText, "");
      return;
    }
    updateResult(response.result);
  } catch (error) {
    const message = error.message || "无法访问当前网页，请刷新后重试。";
    if (type === "PREVIEW_SELECTED_COURSES" && isClosedMessagePortError(message)) {
      setStatus("网页预览正在生成，请查看选课页面上方的“我的课表”窗口。", "ok");
    } else if (type === "EXPAND_SELECTED_COURSES" && isClosedMessagePortError(message)) {
      setStatus("展开任务仍可能在页面中继续运行，请稍等结果更新；如无变化再点一次。", "warn");
    } else if (type === "EXPAND_SELECTED_COURSES_ALL_PAGES" && isClosedMessagePortError(message)) {
      setStatus("自动翻页任务可能仍在页面中继续运行，请等待课程表更新。", "warn");
    } else {
      setStatus(message, "warn");
    }
  } finally {
    if (!state.pendingAsyncScrape) {
      setBusy(false);
    }
  }
}

async function scanCourseGroups() {
  setBusy(true);
  setStatus("正在读取当前页面的课程大类...", "");
  try {
    const response = await sendToActiveTab("SCAN_COURSE_GROUPS");
    if (!response?.ok) {
      throw new Error(response?.error || "读取课程大类失败");
    }
    if (response.result?.courses?.length) {
      updateResult(response.result, false);
      els.groupPicker.hidden = true;
      setStatus(`已识别校公选课，当前页读取 ${response.result.courses.length} 门课程`, "ok");
      return;
    }
    const beforeCount = state.courseGroups.length;
    const byKey = new Map(state.courseGroups.map((group) => [group.key, group]));
    for (const group of response.groups || []) {
      byKey.set(group.key, group);
    }
    state.courseGroups = [...byKey.values()];
    await persistGroupCache();
    renderCourseGroups();
    els.groupPicker.hidden = false;
    const visibleCount = getVisibleCourseGroups().length;
    const addedCount = state.courseGroups.length - beforeCount;
    setStatus(visibleCount > 0 ? `本页新增 ${addedCount} 个，当前累计 ${visibleCount} 个课程大类` : "当前页面没有识别到可展开的课程大类", visibleCount > 0 ? "ok" : "warn");
  } catch (error) {
    setStatus(error.message || "读取课程大类失败", "warn");
  } finally {
    setBusy(false);
  }
}

async function scanAllPages() {
  setBusy(true);
  setStatus("正在读取当前页并自动翻页追加课程大类...", "");
  try {
    const response = await sendToActiveTab("SCAN_COURSE_GROUPS_ALL_PAGES", getCrawlOptions());
    if (!response?.ok) {
      throw new Error(response?.error || "自动翻页读取失败");
    }
    if (response.result?.courses?.length) {
      updateResult(response.result, false);
      els.groupPicker.hidden = true;
      const backText = response.returnedToFirstPage === false ? "，未能返回第一页" : "，已返回第一页";
      setStatus(`校公选课已读取 ${response.pages || 1} 页${backText}，共 ${response.result.courses.length} 门课程`, "ok");
      return;
    }
    const beforeCount = state.courseGroups.length;
    const byKey = new Map(state.courseGroups.map((group) => [group.key, group]));
    for (const group of response.groups || []) {
      byKey.set(group.key, group);
    }
    state.courseGroups = [...byKey.values()];
    await persistGroupCache();
    renderCourseGroups();
    els.groupPicker.hidden = false;
    const visibleCount = getVisibleCourseGroups().length;
    const addedCount = state.courseGroups.length - beforeCount;
    const backText = response.returnedToFirstPage === false ? "，未能返回第一页" : "，已返回第一页";
    setStatus(`已读取 ${response.pages || 1} 页${backText}，本次新增 ${addedCount} 个大类，累计 ${visibleCount} 个课程大类`, visibleCount ? "ok" : "warn");
  } catch (error) {
    setStatus(error.message || "自动翻页读取失败", "warn");
  } finally {
    setBusy(false);
  }
}

function getCrawlOptions() {
  const pageLimit = Math.max(1, Math.min(50, Number.parseInt(els.crawlPageLimit.value, 10) || 50));
  const delaySeconds = Math.max(0.5, Math.min(15, Number.parseFloat(els.crawlDelaySeconds.value) || 0.5));
  els.crawlPageLimit.value = String(pageLimit);
  els.crawlDelaySeconds.value = String(delaySeconds);
  return {
    maxPages: pageLimit,
    pageDelayMs: Math.round(delaySeconds * 1000),
    detailDelayMs: Math.max(500, Math.min(2000, Math.round(delaySeconds * 280))),
    courseRegex: String(els.crawlCourseRegex.value || "").trim()
  };
}

async function clearAllCourseCache() {
  const hostKey = resultKeyForHost(state.currentHost);
  const deletedKey = deletedCoursesKeyForHost(state.currentHost);
  const groupKey = groupCacheKeyForHost(state.currentHost);
  const planKey = planCacheKeyForHost(state.currentHost);
  const removeKeys = [hostKey, deletedKey, groupKey, planKey, FILTER_PREFS_KEY];
  if (resultBelongsHere(state.result)) {
    removeKeys.push(LAST_RESULT_KEY);
  }
  await storageRemove(removeKeys.filter(Boolean));

  state.result = null;
  state.planResult = null;
  state.activePlanIndex = -1;
  state.courseGroups = [];
  state.selectedGroupKeys.clear();
  state.excludedCategories.clear();
  state.deletedCourseKeys.clear();
  for (const filter of categoryFilters) {
    filter.element.checked = false;
  }
  renderCourseGroups();
  els.groupPicker.hidden = true;
  resetPlanControls();
  renderCurrentView();
  els.timeLabel.textContent = "尚无结果";
  els.planMeta.textContent = "等待课程数据";
  els.resetCourseEdits.disabled = true;
  els.generatePlans.disabled = true;
  els.showCalendar.disabled = true;
  setExportEnabled(false);
  setStatus("已清空当前网站课程缓存，可以重新读取课程大类", "ok");
}

function renderCourseGroups() {
  if (!state.courseGroups.length) {
    els.groupList.textContent = "";
    els.groupCount.textContent = "0";
    syncSelectedGroupUi();
    return;
  }

  const groups = getVisibleCourseGroups();
  els.groupList.textContent = "";
  for (const group of groups) {
    const label = document.createElement("label");
    label.className = "group-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedGroupKeys.has(group.key);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selectedGroupKeys.add(group.key);
      } else {
        state.selectedGroupKeys.delete(group.key);
      }
      syncSelectedGroupUi();
      persistGroupCache();
      refreshAfterGroupSelection();
    });

    const name = document.createElement("span");
    name.className = "group-name";
    name.textContent = group.courseName || "未命名课程";
    const detail = document.createElement("span");
    detail.className = "group-detail";
    detail.textContent = [group.courseCategory, group.courseNature, group.credits ? `${group.credits}学分` : ""]
      .filter(Boolean)
      .join(" · ");
    name.append(detail);

    const count = document.createElement("span");
    count.className = "group-class-count";
    const processed = new Set(state.result?.processedGroupKeys || []).has(group.key);
    count.textContent = processed ? "已爬" : group.classCount ? `${group.classCount}班` : "";
    if (processed) {
      label.classList.add("processed");
    }
    label.append(checkbox, name, count);
    els.groupList.append(label);
  }
  els.groupCount.textContent = String(groups.length);
  syncSelectedGroupUi();
}

function getVisibleCourseGroups() {
  return state.courseGroups.filter((group) => {
    for (const category of state.excludedCategories) {
      if (CourseScheduler.matchesCategory(group, category)) {
        return false;
      }
    }
    return true;
  }).sort((a, b) => {
    const categoryA = `${a.courseCategory || ""}${a.courseNature || ""}`;
    const categoryB = `${b.courseCategory || ""}${b.courseNature || ""}`;
    const creditsA = Number.parseFloat(String(a.credits || "").replace(/[^\d.]/g, "")) || 0;
    const creditsB = Number.parseFloat(String(b.credits || "").replace(/[^\d.]/g, "")) || 0;
    return categoryA.localeCompare(categoryB, "zh-CN") || creditsB - creditsA || String(a.courseName || "").localeCompare(String(b.courseName || ""), "zh-CN");
  });
}

function removeHiddenGroupSelections() {
  const visibleKeys = new Set(getVisibleCourseGroups().map((group) => group.key));
  state.selectedGroupKeys = new Set([...state.selectedGroupKeys].filter((key) => visibleKeys.has(key)));
}

function syncSelectedGroupUi() {
  const count = state.selectedGroupKeys.size;
  els.selectedGroupCount.textContent = `已勾选 ${count} 个大类`;
  els.expandAndScrape.disabled = count === 0;
  els.expandAllPages.disabled = count === 0;
}

function updateResult(result, showStatus = true, preservePlanCache = false) {
  state.result = result;
  invalidatePlans(preservePlanCache);
  renderCurrentView();
  renderCourseGroups();
  const count = getCandidateCourses().length;
  const schedulableCount = getSchedulableCourses().length;
  els.timeLabel.textContent = result?.scrapedAt ? formatTime(result.scrapedAt) : "尚无结果";
  setExportEnabled(count > 0);
  els.generatePlans.disabled = schedulableCount === 0;
  els.resetCourseEdits.disabled = !hasCourseEdits();
  els.planMeta.textContent = count > 0
    ? schedulableCount > 0 ? `已识别 ${count} 条候选教学班` : "已有课程大类，请先爬取勾选大类的教学班"
    : "等待课程数据";
  els.showCalendar.disabled = true;

  if (showStatus) {
    const expanded = Number(result?.expandedCount || 0);
    const prefix = expanded > 0 ? `已展开 ${expanded} 个详情，` : "";
    setStatus(count > 0 ? `${prefix}已生成 ${count} 门课程的表格` : "没有识别到课程数据，可尝试框选课表区域。", count > 0 ? "ok" : "warn");
  }
}

function generateSchedulePlans() {
  const courses = getCandidateCourses();
  if (!courses.length) {
    setStatus("请先爬取课程数据", "warn");
    return;
  }
  if (!getSchedulableCourses().length) {
    setStatus("当前只有课程大类，没有老师和上课时间；请先点击“2. 爬取勾选大类”", "warn");
    return;
  }

  els.generatePlans.disabled = true;
  setStatus("正在组合教学班并排除时间冲突...", "");
  const constraints = els.planningMode.value === "advanced" ? getScheduleConstraints() : {};
  setTimeout(() => {
    try {
      const strategy = els.strategySelect.value;
      const outcome = CourseScheduler.generatePlans(courses, strategy, 8, constraints);
      state.planResult = {
        ...outcome,
        strategy,
        generatedAt: new Date().toISOString()
      };
      populatePlanSelect(outcome.plans);
      if (!outcome.plans.length) {
        persistPlanSession();
        const blocked = outcome.blockedAt ? `“${outcome.blockedAt}”与已有课程全部冲突` : "课程时间为空或格式无法识别";
        els.planMeta.textContent = blocked;
        setStatus(`无法生成方案：${blocked}`, "warn");
        return;
      }
      showPlan(0);
      persistPlanSession();
      const skippedText = outcome.skipped.length ? `，跳过 ${outcome.skipped.length} 门无时间课程` : "";
      setStatus(`已生成 ${outcome.plans.length} 份无冲突方案${skippedText}`, "ok");
    } catch (error) {
      setStatus(error.message || "排课方案生成失败", "warn");
    } finally {
      els.generatePlans.disabled = false;
    }
  }, 20);
}

function getScheduleConstraints() {
  return {
    maxDays: Number(els.maxDaysSelect.value || 0),
    earlyPolicy: els.earlyPolicySelect.value,
    eveningPolicy: els.eveningPolicySelect.value,
    acceptEvening: els.acceptEveningToggle.checked
  };
}

function togglePlanningMode() {
  const advanced = els.planningMode.value === "advanced";
  els.advancedOptions.hidden = !advanced;
}

function populatePlanSelect(plans) {
  els.planSelect.textContent = "";
  if (!plans.length) {
    const option = document.createElement("option");
    option.textContent = "没有可用方案";
    option.value = "";
    els.planSelect.append(option);
    els.planSelect.disabled = true;
    els.downloadAllPlans.disabled = true;
    return;
  }
  plans.forEach((plan, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = plan.label;
    els.planSelect.append(option);
  });
  els.planSelect.disabled = false;
  els.downloadAllPlans.disabled = false;
}

function showPlan(index) {
  const plan = state.planResult?.plans?.[index];
  if (!plan) {
    return;
  }
  state.activePlanIndex = index;
  els.planSelect.value = String(index);
  els.showCandidates.disabled = false;
  els.showCalendar.disabled = false;
  renderCurrentView();
  persistPlanSession();
  refreshCalendarPreview();
  const freeDays = plan.metrics.freeWeekdays;
  const strategy = state.planResult?.strategy || "compact";
  const earlyText = strategy === "no-early"
    ? plan.metrics.earlySessions ? `，含 ${plan.metrics.earlySessions} 个1-2节时段` : "，无1-2节课程"
    : "";
  const skippedText = plan.skippedCourses?.length ? `，跳过 ${plan.skippedCourses.length} 门冲突课程` : "";
  const customText = constraintSummary(state.planResult?.constraints);
  const freeDayNames = plan.metrics.freeWeekdayNames?.length ? plan.metrics.freeWeekdayNames.join("、") : "无工作日";
  const scoreText = plan.metrics.score ? `，综合 ${plan.metrics.score.total} 分（天数 ${plan.metrics.score.classDays} · 课程 ${plan.metrics.score.courseCount} · 学分 ${plan.metrics.score.credits} · 早八舒适度 ${plan.metrics.score.earlyComfort} · 晚课 ${plan.metrics.score.evening} · 密度 ${plan.metrics.score.density}）` : "";
  els.planMeta.textContent = `${plan.courses.length}/${plan.metrics.totalGroups || plan.courses.length} 门课，${formatCredits(totalCredits(plan.courses))} 学分，${freeDays} 个工作日无课（${freeDayNames}）${earlyText}${skippedText}${customText}${scoreText}`;
}

function constraintSummary(constraints = {}) {
  const parts = [];
  if (Number(constraints.maxDays || 0) > 0) parts.push(`最多${constraints.maxDays}天`);
  if (constraints.earlyPolicy === "forbid") parts.push("禁早八");
  if (constraints.earlyPolicy === "require") parts.push("有早八");
  if (constraints.eveningPolicy === "forbid") parts.push("禁晚课");
  if (constraints.eveningPolicy === "require") parts.push("有晚课");
  if (constraints.acceptEvening === false) parts.push("不接受11-14节");
  return parts.length ? ` · ${parts.join("、")}` : "";
}

function resetPlanControls() {
  els.planSelect.textContent = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = "尚未生成方案";
  els.planSelect.append(option);
  els.planSelect.disabled = true;
  els.downloadAllPlans.disabled = true;
  els.showCandidates.disabled = true;
}

function renderCurrentView() {
  const courses = getVisibleCourses();
  renderRows(courses);
  els.countLabel.textContent = String(courses.length);
  els.creditLabel.textContent = formatCredits(totalCredits(courses));
}

function totalCredits(courses) {
  const byCourse = new Map();
  for (const course of courses) {
    const value = Number.parseFloat(String(course.credits || "").replace(/[^\d.]/g, ""));
    if (!Number.isFinite(value)) {
      continue;
    }
    const key = String(course.courseName || "").trim().toLocaleLowerCase("zh-CN");
    byCourse.set(key, Math.max(byCourse.get(key) || 0, value));
  }
  return [...byCourse.values()].reduce((sum, value) => sum + value, 0);
}

function formatCredits(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function buildCalendarCourses(courses) {
  return courses.flatMap((course) => {
    const sessions = CourseScheduler.parseSchedule(course.time || "");
    return sessions.map((session) => ({
      courseName: course.courseName || "未命名课程",
      teacher: course.teacher || "",
      credits: course.credits || "",
      time: course.time || "",
      day: session.day,
      start: session.start,
      end: session.end,
      weeks: weekMaskLabel(session.weekMask)
    }));
  });
}

function refreshCalendarPreview() {
  if (!state.calendarPreviewOpen || state.activePlanIndex < 0) {
    return;
  }
  sendToActiveTab("UPDATE_CALENDAR", { courses: buildCalendarCourses(getVisibleCourses()) })
    .then((response) => {
      if (!response?.updated) {
        state.calendarPreviewOpen = false;
      }
    })
    .catch(() => {
      state.calendarPreviewOpen = false;
    });
}

function weekMaskLabel(mask) {
  const weeks = [];
  for (let week = 1; week <= 30; week += 1) {
    if ((mask & (1 << (week - 1))) !== 0) {
      weeks.push(week);
    }
  }
  if (!weeks.length) {
    return "";
  }
  const ranges = [];
  let start = weeks[0];
  let previous = weeks[0];
  for (let index = 1; index <= weeks.length; index += 1) {
    const current = weeks[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push(start === previous ? `${start}周` : `${start}-${previous}周`);
    start = current;
    previous = current;
  }
  return ranges.join("、");
}

function getVisibleCourses() {
  if (state.activePlanIndex >= 0) {
    return state.planResult?.plans?.[state.activePlanIndex]?.courses || [];
  }
  return getCandidateCourses();
}

function getCandidateCourses() {
  return (state.result?.courses || []).filter((course) => {
    if (!belongsToSelectedGroup(course)) {
      return false;
    }
    if (state.deletedCourseKeys.has(courseKey(course))) {
      return false;
    }
    for (const category of state.excludedCategories) {
      if (CourseScheduler.matchesCategory(course, category)) {
        return false;
      }
    }
    return true;
  });
}

function belongsToSelectedGroup(course) {
  if (!state.courseGroups.length) {
    return true;
  }
  const selectedGroups = state.courseGroups.filter((group) => state.selectedGroupKeys.has(group.key));
  if (!selectedGroups.length) {
    return false;
  }
  const courseName = String(course.courseName || "").replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
  const courseNumber = String(course.courseNumber || "").replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
  const courseCategory = String(course.courseCategory || "").replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
  return selectedGroups.some((group) => {
    const groupName = String(group.courseName || "").replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
    const groupNumber = String(group.courseNumber || "").replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
    const groupCategory = String(group.courseCategory || "").replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
    return (courseName && groupName && courseName === groupName)
      || (courseNumber && groupNumber && courseNumber === groupNumber)
      || (courseCategory.includes("校公选") && (groupName.includes("校公选") || groupCategory.includes("校公选")));
  });
}

function refreshAfterGroupSelection() {
  invalidatePlans();
  renderCurrentView();
  const count = getCandidateCourses().length;
  setExportEnabled(count > 0);
  els.generatePlans.disabled = getSchedulableCourses().length === 0;
  els.showCalendar.disabled = true;
  els.planMeta.textContent = count > 0 ? `当前勾选大类保留 ${count} 门课程` : "当前勾选大类没有已爬取课程，请点击爬取勾选大类";
}

function getSchedulableCourses() {
  return getCandidateCourses().filter((course) => CourseScheduler.parseSchedule(course.time || "").length > 0);
}

function renderRows(courses) {
  els.courseRows.textContent = "";
  if (!courses.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.className = "empty";
    cell.textContent = "暂无课程数据";
    row.append(cell);
    els.courseRows.append(row);
    return;
  }

  for (const course of courses) {
    const row = document.createElement("tr");
    for (const key of fields) {
      const cell = document.createElement("td");
      cell.textContent = course[key] || "";
      row.append(cell);
    }
    const actionCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-course";
    deleteButton.textContent = "×";
    deleteButton.title = `删除 ${course.courseName || "课程"}`;
    deleteButton.setAttribute("aria-label", deleteButton.title);
    deleteButton.addEventListener("click", () => deleteCourse(course));
    actionCell.append(deleteButton);
    row.append(actionCell);
    els.courseRows.append(row);
  }
}

function toCsv(courses, mode) {
  const exportFields = mode === "minimal"
    ? ["courseName", "time"]
    : [...fields, "courseCategory", "courseNature", "source", "rawText"];
  const exportCourses = toExportCourses(courses, mode);
  const rows = [
    exportFields.map((key) => labels[key]),
    ...exportCourses.map((course) => exportFields.map((key) => course[key] || ""))
  ];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function toExportCourses(courses, mode) {
  if (mode === "minimal") {
    return courses.map((course) => ({
      courseName: course.courseName || "",
      time: CourseScheduler.compactTime(course)
    }));
  }
  return courses.map((course) => {
    const output = {};
    for (const key of [...fields, "courseCategory", "courseNature", "source", "rawText"]) {
      output[key] = course[key] || "";
    }
    return output;
  });
}

function exportModeLabel() {
  return state.exportMode === "minimal" ? "精简" : "详细";
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text || "");
    setStatus(successMessage, "ok");
  } catch {
    setStatus("复制失败：浏览器没有开放剪贴板权限", "warn");
  }
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileStem(suffix = "") {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const view = state.activePlanIndex >= 0 ? `plan-${state.activePlanIndex + 1}` : "candidates";
  const mode = state.exportMode === "minimal" ? "minimal" : "detailed";
  return `courses-${view}-${mode}${suffix ? `-${suffix}` : ""}-${stamp}`;
}

function setBusy(isBusy) {
  els.crawlPageLimit.disabled = isBusy;
  els.crawlDelaySeconds.disabled = isBusy;
  els.crawlCourseRegex.disabled = isBusy;
  els.scanCourseGroups.disabled = isBusy;
  els.scanAllPages.disabled = isBusy;
  els.expandAndScrape.disabled = isBusy;
  els.expandAllPages.disabled = isBusy || state.selectedGroupKeys.size === 0;
  els.generatePlans.disabled = isBusy || !getSchedulableCourses().length;
  els.showCalendar.disabled = isBusy || state.activePlanIndex < 0 || !getVisibleCourses().length;
  if (!isBusy) {
    setExportEnabled(Boolean(getCandidateCourses().length));
    syncSelectedGroupUi();
  }
}

function deleteCourse(course) {
  const targetName = String(course.courseName || "").trim().toLocaleLowerCase("zh-CN");
  const targetSchedule = CourseScheduler.courseScheduleSignature(course);
  const matchingCourses = (state.result?.courses || []).filter((candidate) => {
    const candidateName = String(candidate.courseName || "").trim().toLocaleLowerCase("zh-CN");
    return candidateName === targetName && CourseScheduler.courseScheduleSignature(candidate) === targetSchedule;
  });
  for (const candidate of matchingCourses.length ? matchingCourses : [course]) {
    state.deletedCourseKeys.add(courseKey(candidate));
  }
  storageSet({ [deletedCoursesKeyForHost(state.currentHost)]: [...state.deletedCourseKeys] });
  refreshAfterCourseEdit(`已删除 ${course.courseName || "课程"}`);
}

function refreshAfterCourseEdit(message) {
  invalidatePlans();
  renderCurrentView();
  if (!state.result) {
    els.resetCourseEdits.disabled = !hasCourseEdits();
    els.showCalendar.disabled = true;
    els.planMeta.textContent = "等待课程数据";
    setStatus(message, "ok");
    return;
  }
  const count = getCandidateCourses().length;
  setExportEnabled(count > 0);
  els.generatePlans.disabled = getSchedulableCourses().length === 0;
  els.showCalendar.disabled = true;
  els.resetCourseEdits.disabled = !hasCourseEdits();
  els.planMeta.textContent = count > 0
    ? getSchedulableCourses().length > 0 ? `当前保留 ${count} 条候选教学班` : "当前只有课程大类，请先爬取教学班"
    : "当前没有保留的课程";
  setStatus(`${message}，剩余 ${count} 条`, count > 0 ? "ok" : "warn");
}

function invalidatePlans(preservePlanCache = false) {
  state.planResult = null;
  state.activePlanIndex = -1;
  resetPlanControls();
  if (!preservePlanCache) {
    storageRemove([planCacheKeyForHost(state.currentHost)]);
  }
}

function hasCourseEdits() {
  return state.excludedCategories.size > 0 || state.deletedCourseKeys.size > 0;
}

function courseKey(course) {
  return [
    course.courseName,
    course.teacher,
    course.weeks,
    course.time,
    course.sections,
    course.credits,
    course.courseCategory,
    course.courseNature
  ].map((value) => String(value || "").replace(/\s+/g, "").toLocaleLowerCase("zh-CN")).join("|");
}

function persistCategoryFilters() {
  return storageSet({ [FILTER_PREFS_KEY]: [...state.excludedCategories] });
}

function persistGroupCache() {
  return storageSet({
    [groupCacheKeyForHost(state.currentHost)]: {
      groups: state.courseGroups,
      selectedGroupKeys: [...state.selectedGroupKeys]
    }
  });
}

function persistPlanSession() {
  const key = planCacheKeyForHost(state.currentHost);
  const plans = state.planResult?.plans || [];
  if (!key) {
    return Promise.resolve();
  }
  if (!plans.length || !state.result) {
    return storageRemove([key]);
  }

  return storageSet({
    [key]: {
      resultScrapedAt: state.result.scrapedAt || "",
      resultCourseCount: state.result.courses?.length || 0,
      activePlanIndex: state.activePlanIndex,
      exportMode: state.exportMode,
      preferences: getPlanPreferences(),
      planResult: {
        strategy: state.planResult.strategy,
        generatedAt: state.planResult.generatedAt,
        constraints: state.planResult.constraints || {},
        skipped: state.planResult.skipped || [],
        groupCount: state.planResult.groupCount || 0,
        plans: plans.map((plan) => ({
          id: plan.id,
          label: plan.label,
          metrics: plan.metrics,
          skippedCourses: plan.skippedCourses || [],
          courseKeys: plan.courses.map(courseKey)
        }))
      }
    }
  });
}

function getPlanPreferences() {
  return {
    planningMode: els.planningMode.value,
    strategy: els.strategySelect.value,
    maxDays: els.maxDaysSelect.value,
    earlyPolicy: els.earlyPolicySelect.value,
    eveningPolicy: els.eveningPolicySelect.value,
    acceptEvening: els.acceptEveningToggle.checked
  };
}

function restorePlanSession(saved) {
  if (!saved || !state.result || saved.resultScrapedAt !== (state.result.scrapedAt || "")
    || Number(saved.resultCourseCount || 0) !== Number(state.result.courses?.length || 0)) {
    return;
  }

  applyPlanPreferences(saved.preferences);
  state.exportMode = saved.exportMode === "minimal" ? "minimal" : "detailed";
  document.querySelector(`input[name="exportMode"][value="${state.exportMode}"]`)?.click();

  const coursesByKey = new Map((state.result.courses || []).map((course) => [courseKey(course), course]));
  const plans = (saved.planResult?.plans || []).map((plan) => ({
    id: plan.id,
    label: plan.label,
    metrics: plan.metrics,
    skippedCourses: plan.skippedCourses || [],
    courseKeys: plan.courseKeys || [],
    courses: (plan.courseKeys || []).map((key) => coursesByKey.get(key)).filter(Boolean)
  })).filter((plan) => plan.courses.length === plan.courseKeys.length);

  if (!plans.length) {
    return;
  }

  state.planResult = {
    ...(saved.planResult || {}),
    plans
  };
  populatePlanSelect(plans);
  const activeIndex = Number(saved.activePlanIndex);
  if (Number.isInteger(activeIndex) && activeIndex >= 0 && activeIndex < plans.length) {
    showPlan(activeIndex);
  } else {
    state.activePlanIndex = -1;
    renderCurrentView();
    els.showCandidates.disabled = true;
    els.showCalendar.disabled = true;
  }
  setStatus(`已恢复 ${plans.length} 份排课方案`, "ok");
}

function applyPlanPreferences(preferences = {}) {
  const setSelectValue = (element, value) => {
    if ([...element.options].some((option) => option.value === value)) {
      element.value = value;
    }
  };
  setSelectValue(els.planningMode, preferences.planningMode);
  setSelectValue(els.strategySelect, preferences.strategy);
  setSelectValue(els.maxDaysSelect, preferences.maxDays);
  setSelectValue(els.earlyPolicySelect, preferences.earlyPolicy);
  setSelectValue(els.eveningPolicySelect, preferences.eveningPolicy);
  if (typeof preferences.acceptEvening === "boolean") {
    els.acceptEveningToggle.checked = preferences.acceptEvening;
  }
  togglePlanningMode();
}

function setExportEnabled(enabled) {
  els.copyCsv.disabled = !enabled;
  els.copyJson.disabled = !enabled;
  els.downloadCsv.disabled = !enabled;
  els.downloadJson.disabled = !enabled;
  if (!enabled) {
    els.downloadAllPlans.disabled = true;
  }
}

function setStatus(text, tone) {
  els.status.textContent = text;
  els.status.className = `status ${tone || ""}`.trim();
}

function sendToActiveTab(type, payload = {}) {
  if (!state.activeTabId) {
    return Promise.reject(new Error("没有找到当前标签页"));
  }

  const message = {
    source: POPUP_SOURCE,
    type,
    payload
  };

  return postMessageToActiveTab(message)
    .then(async (response) => {
      if (response?.ok === false && isStaleContentScriptError(response.error)) {
        await injectContentScript();
        return postMessageToActiveTab(message);
      }
      return response;
    })
    .catch(async (error) => {
      if (!canInjectContentScript()) {
        throw error;
      }
      await injectContentScript();
      return postMessageToActiveTab(message);
    });
}

function postMessageToActiveTab(message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(state.activeTabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || "无法访问此页面，请在普通网页或教务系统页面中使用。"));
        return;
      }
      resolve(response);
    });
  });
}

function injectContentScript() {
  return new Promise((resolve, reject) => {
    if (!canInjectContentScript()) {
      reject(new Error("当前扩展缺少脚本注入权限，请在扩展管理页重新加载插件。"));
      return;
    }

    chrome.scripting.executeScript(
      {
        target: { tabId: state.activeTabId },
        files: ["content-script.js"]
      },
      () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message || "无法注入页面脚本，请刷新页面后重试。"));
          return;
        }
        setTimeout(resolve, 80);
      }
    );
  });
}

function canInjectContentScript() {
  return Boolean(state.activeTabId && chrome.scripting?.executeScript);
}

function isStaleContentScriptError(error) {
  return /未知操作|unknown operation/i.test(String(error || ""));
}

function isClosedMessagePortError(error) {
  return /message port closed|receiving end does not exist|extension context invalidated/i.test(String(error || ""));
}

function queryTabs(query) {
  return new Promise((resolve) => chrome.tabs.query(query, resolve));
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

function storageRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

function getHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function resultKeyForHost(host) {
  return host ? `courseScraper:last:${host}` : "";
}

function deletedCoursesKeyForHost(host) {
  return host ? `courseScraper:deleted:${host}` : "courseScraper:deleted:default";
}

function groupCacheKeyForHost(host) {
  return host ? `courseScraper:groups:${host}` : "courseScraper:groups:default";
}

function planCacheKeyForHost(host) {
  return host ? `courseScraper:plans:${host}` : "courseScraper:plans:default";
}

function resultBelongsHere(result) {
  if (!result) {
    return false;
  }
  return getHost(result.url || "") === state.currentHost;
}

function formatTime(value) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return "刚刚";
  }
}
