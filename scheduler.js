(() => {
  const DAY_LABELS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const DAY_PATTERNS = [
    [/(?:星期|周|礼拜)一/, 1],
    [/(?:星期|周|礼拜)二/, 2],
    [/(?:星期|周|礼拜)三/, 3],
    [/(?:星期|周|礼拜)四/, 4],
    [/(?:星期|周|礼拜)五/, 5],
    [/(?:星期|周|礼拜)六/, 6],
    [/(?:星期|周|礼拜)(?:日|天|七)/, 7]
  ];
  const WEEK_RE = /(\d{1,2})(?:\s*[-~至到–—]\s*(\d{1,2}))?\s*周(?:\s*[（(]?\s*(单|双)\s*[)）]?)?/g;
  const SECTION_RE = /(?:第\s*)?(\d{1,2})(?:\s*[-~至到–—]\s*(\d{1,2}))?\s*节/g;
  const DEFAULT_WEEK_MASK = buildWeekMask(1, 30);
  const MAX_BEAM_WIDTH = 1200;

  function parseSchedule(value) {
    const text = String(value || "").replace(/\u00a0/g, " ").replace(/\r/g, "\n").trim();
    if (!text) {
      return [];
    }

    const chunks = text
      .split(/[；;\n]+/)
      .map((chunk) => chunk.replace(/^\s*[·•]\s*/, "").trim())
      .filter(Boolean);
    const sessions = [];
    let pendingWeekMask = 0;

    for (const chunk of chunks) {
      const chunkWeekMask = parseWeekMask(chunk);
      const day = parseDay(chunk);
      const sectionRanges = parseSectionRanges(chunk);

      if (!day || !sectionRanges.length) {
        if (chunkWeekMask) {
          pendingWeekMask |= chunkWeekMask;
        }
        continue;
      }

      const weekMask = pendingWeekMask | chunkWeekMask || DEFAULT_WEEK_MASK;
      pendingWeekMask = 0;
      for (const [start, end] of sectionRanges) {
        sessions.push({ day, start, end, weekMask });
      }
    }

    return dedupeSessions(sessions);
  }

  function parseDay(text) {
    for (const [pattern, day] of DAY_PATTERNS) {
      if (pattern.test(text)) {
        return day;
      }
    }
    return 0;
  }

  function parseWeekMask(text) {
    let mask = 0;
    WEEK_RE.lastIndex = 0;
    for (const match of text.matchAll(WEEK_RE)) {
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      const parity = match[3] || "";
      for (let week = start; week <= end && week <= 30; week += 1) {
        if ((parity === "单" && week % 2 === 0) || (parity === "双" && week % 2 !== 0)) {
          continue;
        }
        mask |= 1 << (week - 1);
      }
    }
    return mask;
  }

  function parseSectionRanges(text) {
    const ranges = [];
    SECTION_RE.lastIndex = 0;
    for (const match of text.matchAll(SECTION_RE)) {
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      if (start >= 1 && end >= start && end <= 30) {
        ranges.push([start, end]);
      }
    }
    return ranges;
  }

  function buildWeekMask(start, end) {
    let mask = 0;
    for (let week = start; week <= end && week <= 30; week += 1) {
      mask |= 1 << (week - 1);
    }
    return mask;
  }

  function dedupeSessions(sessions) {
    const seen = new Set();
    return sessions.filter((session) => {
      const key = sessionKey(session);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function sessionKey(session) {
    return `${session.day}:${session.start}-${session.end}:${session.weekMask >>> 0}`;
  }

  function scheduleKey(sessions) {
    return sessions.map(sessionKey).sort().join("|");
  }

  function compactTime(course) {
    const sessions = parseSchedule(course?.time || "");
    if (!sessions.length) {
      return normalize(course?.time || course?.sections || "");
    }
    const values = sessions
      .sort(compareSessions)
      .map((session) => `${DAY_LABELS[session.day]} ${session.start}${session.end === session.start ? "" : `-${session.end}`}节`);
    return [...new Set(values)].join("；");
  }

  function courseScheduleSignature(course) {
    return scheduleKey(parseSchedule(course?.time || ""));
  }

  function matchesCategory(course, filterKey) {
    const category = normalize(course?.courseCategory || "").replace(/\s+/g, "");
    const nature = normalize(course?.courseNature || "").replace(/\s+/g, "");
    const rawText = normalize(course?.rawText || "").replace(/\s+/g, "");
    const isElective = /选修/.test(nature);
    const isRequired = /必修/.test(nature);

    if (filterKey === "public-elective" && /校公选/.test(`${category}${rawText}`)) {
      return true;
    }
    if (filterKey === "public-elective") {
      return /公共选修课?/.test(category) || (/公共/.test(category) && isElective) || /公共选修课/.test(rawText);
    }
    if (filterKey === "public-required") {
      return /公共必修课?/.test(category) || (/公共/.test(category) && isRequired) || /公共必修课/.test(rawText);
    }
    if (filterKey === "public-elective" && /校公选/.test(`${category}${rawText}`)) {
      return true;
    }
    if (filterKey === "professional-elective") {
      return /专业选修课?/.test(category) || (/专业/.test(category) && isElective) || /专业选修课/.test(rawText);
    }
    if (filterKey === "professional-required") {
      return /专业必修课?/.test(category) || (/专业/.test(category) && isRequired) || /专业必修课/.test(rawText);
    }
    if (filterKey === "sports") {
      return /体育|体育课/.test(category) || /体育|体育课/.test(course?.courseName || "") || /体育|体育课/.test(rawText);
    }
    if (filterKey === "mooc") {
      return /mooc|慕课/i.test(category) || /mooc|慕课/i.test(course?.courseName || "") || /mooc|慕课/i.test(rawText);
    }
    return false;
  }

  function prepareCourseGroups(courses) {
    const grouped = new Map();
    const namesWithInvalidTimes = new Set();
    const namesWithValidTimes = new Set();
    for (const original of courses || []) {
      const courseName = normalize(original?.courseName || "");
      if (!courseName) {
        continue;
      }
      const sessions = parseSchedule(original.time || "");
      if (!sessions.length) {
        namesWithInvalidTimes.add(courseName);
        continue;
      }
      namesWithValidTimes.add(courseName);
      const key = courseName.toLocaleLowerCase("zh-CN");
      if (!grouped.has(key)) {
        grouped.set(key, { courseName, options: new Map() });
      }
      const group = grouped.get(key);
      const signature = scheduleKey(sessions);
      const option = group.options.get(signature);
      if (option) {
        option.course.teacher = mergeText(option.course.teacher, original.teacher);
        option.course.source = mergeText(option.course.source, original.source);
        option.course.rawText = mergeRawText(option.course.rawText, original.rawText);
      } else {
        group.options.set(signature, {
          course: { ...original, courseName },
          sessions,
          signature
        });
      }
    }

    return {
      groups: [...grouped.values()]
        .map((group) => ({ courseName: group.courseName, options: [...group.options.values()] }))
        .filter((group) => group.options.length)
        .sort((a, b) => a.options.length - b.options.length || a.courseName.localeCompare(b.courseName, "zh-CN")),
      skipped: [...namesWithInvalidTimes].filter((name) => !namesWithValidTimes.has(name))
    };
  }

  function generatePlans(courses, strategy = "compact", maxPlans = 8, constraints = {}) {
    const prepared = prepareCourseGroups(courses);
    if (!prepared.groups.length) {
      return { plans: [], skipped: prepared.skipped, groupCount: 0 };
    }

    let states = [{ selected: [], skippedCourseNames: [], occupancy: new Map(), signature: "", metrics: null }];
    for (const group of prepared.groups) {
      const next = [];
      for (const state of states) {
        next.push({
          selected: state.selected,
          skippedCourseNames: [...state.skippedCourseNames, group.courseName],
          occupancy: state.occupancy,
          signature: "",
          metrics: null
        });
        for (const option of group.options) {
          if (!isOptionAllowed(state, option, constraints) || hasConflict(state.occupancy, option.sessions)) {
            continue;
          }
          next.push(addOption(state, option));
        }
      }
      states = pruneStates(next, strategy, MAX_BEAM_WIDTH, constraints);
    }

    const finalStates = pruneStates(states, strategy, Math.max(1, maxPlans), constraints, true);
    const availableCredits = prepared.groups.reduce((sum, group) => {
      const credits = group.options.map((option) => parseCredits(option.course.credits)).filter(Number.isFinite);
      return sum + (credits.length ? Math.max(...credits) : 0);
    }, 0);
    const plans = finalStates.map((state, index) => {
      const metrics = measureState(state);
      const totalGroups = prepared.groups.length + prepared.skipped.length;
      const score = scorePlan(metrics, totalGroups, availableCredits);
      return {
        id: index + 1,
        courses: state.selected.map((item) => item.course).sort(compareCoursesBySchedule),
        skippedCourses: [...new Set([...prepared.skipped, ...state.skippedCourseNames])],
        metrics: { ...metrics, totalGroups, score },
        label: buildPlanLabel(index + 1, metrics, strategy, score)
      };
    });
    plans.sort((left, right) => comparePlans(left, right, strategy));
    plans.forEach((plan, index) => {
      plan.id = index + 1;
      plan.label = buildPlanLabel(index + 1, plan.metrics, strategy, plan.metrics.score);
    });

    return {
      plans,
      skipped: prepared.skipped,
      groupCount: prepared.groups.length + prepared.skipped.length,
      constraints
    };
  }

  function isOptionAllowed(state, option, constraints) {
    const sessions = option.sessions || [];
    const hasEarly = sessions.some((session) => session.start <= 2);
    const hasEvening = sessions.some((session) => session.end >= 11);
    if (constraints.acceptEvening === false && hasEvening) {
      return false;
    }
    if (constraints.earlyPolicy === "forbid" && hasEarly) {
      return false;
    }
    if (constraints.eveningPolicy === "forbid" && hasEvening) {
      return false;
    }
    const maxDays = Number(constraints.maxDays || 0);
    if (maxDays > 0) {
      const days = new Set();
      for (const key of state.occupancy.keys()) {
        days.add(Number(String(key).split(":")[0]));
      }
      for (const session of sessions) {
        days.add(session.day);
      }
      if (days.size > maxDays) {
        return false;
      }
    }
    return true;
  }

  function hasConflict(occupancy, sessions) {
    for (const session of sessions) {
      for (let section = session.start; section <= session.end; section += 1) {
        const occupiedWeeks = occupancy.get(`${session.day}:${section}`) || 0;
        if ((occupiedWeeks & session.weekMask) !== 0) {
          return true;
        }
      }
    }
    return false;
  }

  function addOption(state, option) {
    const occupancy = new Map(state.occupancy);
    for (const session of option.sessions) {
      for (let section = session.start; section <= session.end; section += 1) {
        const key = `${session.day}:${section}`;
        occupancy.set(key, (occupancy.get(key) || 0) | session.weekMask);
      }
    }
    return {
      selected: [...state.selected, option],
      skippedCourseNames: [...state.skippedCourseNames],
      occupancy,
      signature: "",
      metrics: null
    };
  }

  function pruneStates(states, strategy, limit, constraints = {}, finalOnly = false) {
    const bySchedule = new Map();
    for (const state of states) {
      const signature = `${occupancyKey(state.occupancy)}||${state.selected.map((item) => item.course.courseName).sort().join("|")}`;
      state.signature = signature;
      if (!bySchedule.has(signature)) {
        bySchedule.set(signature, state);
      }
    }
    const candidates = [...bySchedule.values()]
      .filter((state) => !finalOnly || meetsFinalConstraints(state, constraints));
    return candidates
      .map((state) => ({
        state,
        signature: state.signature,
        score: scoreTuple(measureState(state), strategy)
      }))
      .sort(compareScoredStates)
      .slice(0, limit)
      .map((item) => item.state);
  }

  function meetsFinalConstraints(state, constraints) {
    const sessions = state.selected.flatMap((option) => option.sessions || []);
    const hasEarly = sessions.some((session) => session.start <= 2);
    const hasEvening = sessions.some((session) => session.end >= 11);
    if (constraints.earlyPolicy === "require" && !hasEarly) {
      return false;
    }
    if (constraints.eveningPolicy === "require" && !hasEvening) {
      return false;
    }
    return true;
  }

  function occupancyKey(occupancy) {
    return [...occupancy.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, weeks]) => `${key}:${weeks >>> 0}`)
      .join("|");
  }

  function compareScoredStates(a, b) {
    const left = a.score;
    const right = b.score;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        return left[index] - right[index];
      }
    }
    return a.signature.localeCompare(b.signature);
  }

  function comparePlans(left, right, strategy) {
    const leftTuple = scoreTuple(left.metrics, strategy);
    const rightTuple = scoreTuple(right.metrics, strategy);
    for (let index = 0; index < Math.max(leftTuple.length, rightTuple.length); index += 1) {
      const difference = (leftTuple[index] || 0) - (rightTuple[index] || 0);
      if (difference !== 0) {
        return difference;
      }
    }
    return Number(right.metrics.score?.total || 0) - Number(left.metrics.score?.total || 0)
      || left.courses.map((course) => course.courseName).join("|").localeCompare(right.courses.map((course) => course.courseName).join("|"), "zh-CN");
  }

  function scoreTuple(metrics, strategy) {
    if (strategy === "max-courses") {
      return [-metrics.selectedCount];
    }
    const compact = [
      -metrics.selectedCount,
      metrics.classDays,
      -Number(metrics.mondayAndFridayFree),
      -Number(metrics.tuesdayAndThursdayFree),
      -metrics.weekendConnectedFree,
      metrics.gaps,
      metrics.totalSpan,
      metrics.earlySessions
    ];
    if (strategy === "no-early") {
      return [-metrics.selectedCount, metrics.earlySessions, metrics.earlySections, ...compact.slice(1)];
    }
    return compact;
  }

  function scorePlan(metrics, totalGroups, availableCredits = metrics.selectedCredits) {
    const classDaysScore = clampScore(100 - Math.max(0, metrics.classDays - 1) * 20);
    const courseCountScore = totalGroups > 0 ? clampScore((metrics.selectedCount / totalGroups) * 100) : 0;
    const creditsScore = availableCredits > 0 ? clampScore((metrics.selectedCredits / availableCredits) * 100) : 0;
    const earlyComfortScore = clampScore(
      100 - metrics.earlyStartDays * 18 - Math.max(0, metrics.earlySessions - metrics.earlyStartDays) * 3
        + Math.min(10, metrics.lateStartDays * 1.5)
    );
    const eveningScore = clampScore(100 - metrics.eveningDays * 15 - Math.max(0, metrics.eveningSessions - metrics.eveningDays) * 3);
    const densityScore = clampScore(metrics.density * 100);
    const total = classDaysScore * 0.35
      + courseCountScore * 0.25
      + creditsScore * 0.15
      + earlyComfortScore * 0.12
      + eveningScore * 0.08
      + densityScore * 0.05;
    return {
      total: Number(total.toFixed(1)),
      classDays: Number(classDaysScore.toFixed(1)),
      courseCount: Number(courseCountScore.toFixed(1)),
      credits: Number(creditsScore.toFixed(1)),
      earlyComfort: Number(earlyComfortScore.toFixed(1)),
      evening: Number(eveningScore.toFixed(1)),
      density: Number(densityScore.toFixed(1)),
      weights: { classDays: 35, courseCount: 25, credits: 15, earlyComfort: 12, evening: 8, density: 5 }
    };
  }

  function clampScore(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  function measureState(state) {
    if (state.metrics) {
      return state.metrics;
    }
    const daySections = new Map();
    let earlySections = 0;
    for (const key of state.occupancy.keys()) {
      const [dayText, sectionText] = key.split(":");
      const day = Number(dayText);
      const section = Number(sectionText);
      if (!daySections.has(day)) {
        daySections.set(day, new Set());
      }
      daySections.get(day).add(section);
      if (section <= 2) {
        earlySections += 1;
      }
    }

    const weekdayDays = [...daySections.keys()].filter((day) => day >= 1 && day <= 5);
    const free = new Set([1, 2, 3, 4, 5].filter((day) => !daySections.has(day)));
    let gaps = 0;
    let totalSpan = 0;
    for (const sections of daySections.values()) {
      const values = [...sections].sort((a, b) => a - b);
      const span = values[values.length - 1] - values[0] + 1;
      totalSpan += span;
      gaps += span - values.length;
    }

    const earlySessions = state.selected.reduce(
      (count, option) => count + option.sessions.filter((session) => session.start <= 2).length,
      0
    );
    const earlyStartDays = [...daySections.entries()].filter(([, sections]) => [...sections].some((section) => section <= 2)).length;
    const eveningSessions = state.selected.reduce(
      (count, option) => count + option.sessions.filter((session) => session.end >= 11).length,
      0
    );
    const eveningDays = [...daySections.entries()].filter(([, sections]) => [...sections].some((section) => section >= 11)).length;
    const lateStartDays = [...daySections.values()].filter((sections) => Math.min(...sections) >= 3).length;
    const occupiedSections = [...daySections.values()].reduce((sum, sections) => sum + sections.size, 0);
    const selectedCredits = state.selected.reduce((sum, option) => sum + parseCredits(option.course.credits), 0);
    state.metrics = {
      selectedCount: state.selected.length,
      classDays: weekdayDays.length,
      freeWeekdays: 5 - weekdayDays.length,
      freeWeekdayNames: [...free].sort((a, b) => a - b).map((day) => DAY_LABELS[day]),
      mondayAndFridayFree: free.has(1) && free.has(5),
      tuesdayAndThursdayFree: free.has(2) && free.has(4),
      weekendConnectedFree: Number(free.has(1)) + Number(free.has(5)),
      gaps,
      totalSpan,
      earlySessions,
      earlySections,
      earlyStartDays,
      eveningSessions,
      eveningDays,
      lateStartDays,
      occupiedSections,
      selectedCredits,
      density: totalSpan > 0 ? occupiedSections / totalSpan : 0
    };
    return state.metrics;
  }

  function parseCredits(value) {
    const number = Number.parseFloat(String(value || "").replace(/[^\d.]/g, ""));
    return Number.isFinite(number) ? number : 0;
  }

  function buildPlanLabel(index, metrics, strategy, score = null) {
    const early = strategy === "no-early" ? `，早课 ${metrics.earlySessions}` : "";
    const suffix = strategy === "max-courses" ? " · 不设排课限制" : ` · ${metrics.classDays} 天上课${early}`;
    const freeDays = metrics.freeWeekdayNames?.length ? metrics.freeWeekdayNames.join("、") : "无工作日";
    const scoreText = score ? ` · 综合 ${score.total} 分` : "";
    return `方案 ${index} · 选 ${metrics.selectedCount} 门 · 无课：${freeDays}${suffix}${scoreText}`;
  }

  function compareSessions(a, b) {
    return a.day - b.day || a.start - b.start || a.end - b.end || (a.weekMask >>> 0) - (b.weekMask >>> 0);
  }

  function compareCoursesBySchedule(a, b) {
    const aSession = parseSchedule(a.time)[0] || { day: 99, start: 99 };
    const bSession = parseSchedule(b.time)[0] || { day: 99, start: 99 };
    return aSession.day - bSession.day || aSession.start - bSession.start || a.courseName.localeCompare(b.courseName, "zh-CN");
  }

  function mergeText(left, right) {
    const values = [...normalize(left).split(/[、,，/]+/), ...normalize(right).split(/[、,，/]+/)].filter(Boolean);
    return [...new Set(values)].join("、");
  }

  function mergeRawText(left, right) {
    return [...new Set([left, right].map(normalize).filter(Boolean))].join("\n---\n");
  }

  function normalize(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  const api = {
    compactTime,
    courseScheduleSignature,
    generatePlans,
    matchesCategory,
    parseSchedule,
    prepareCourseGroups,
    scorePlan
  };

  globalThis.CourseScheduler = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
