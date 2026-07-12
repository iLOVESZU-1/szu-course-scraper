const test = require("node:test");
const assert = require("node:assert/strict");
const scheduler = require("./scheduler.js");

const ZH = {
  mon: "\u661f\u671f\u4e00",
  tue: "\u661f\u671f\u4e8c",
  wed: "\u661f\u671f\u4e09",
  fri: "\u661f\u671f\u4e94",
  week: "\u5468",
  section: "\u8282"
};

function time(day, sections, weeks = "1-18") {
  return `${weeks}${ZH.week} ${day} ${sections}${ZH.section}`;
}

function course(courseName, value, teacher = "") {
  return { courseName, time: value, teacher, sections: "", credits: "", weeks: "" };
}

test("parses a standard weekly schedule", () => {
  const sessions = scheduler.parseSchedule(time(ZH.fri, "3-4"));
  assert.equal(sessions.length, 1);
  assert.deepEqual({ day: sessions[0].day, start: sessions[0].start, end: sessions[0].end }, { day: 5, start: 3, end: 4 });
  assert.equal(scheduler.compactTime({ time: time(ZH.fri, "3-4") }), "\u5468\u4e94 3-4\u8282");
});

test("applies pending week ranges to the following day and sections", () => {
  const value = `2-8${ZH.week};10-11${ZH.week};13${ZH.week} ${ZH.fri} 7-10${ZH.section}`;
  const sessions = scheduler.parseSchedule(value);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].day, 5);
  assert.equal(sessions[0].start, 7);
  assert.equal(sessions[0].end, 10);
  assert.equal((sessions[0].weekMask & (1 << 1)) !== 0, true);
  assert.equal((sessions[0].weekMask & (1 << 9)) !== 0, true);
  assert.equal((sessions[0].weekMask & (1 << 12)) !== 0, true);
});

test("merges teachers when the same course has the same schedule", () => {
  const prepared = scheduler.prepareCourseGroups([
    course("A", time(ZH.tue, "3-4"), "Teacher 1"),
    course("A", time(ZH.tue, "3-4"), "Teacher 2")
  ]);
  assert.equal(prepared.groups.length, 1);
  assert.equal(prepared.groups[0].options.length, 1);
  assert.equal(prepared.groups[0].options[0].course.teacher, "Teacher 1\u3001Teacher 2");
});

test("matches the four removable course categories", () => {
  assert.equal(scheduler.matchesCategory({ courseCategory: "\u516c\u5171\u9009\u4fee\u8bfe" }, "public-elective"), true);
  assert.equal(scheduler.matchesCategory({ courseCategory: "\u6821\u516c\u9009\u8bfe" }, "public-elective"), true);
  assert.equal(scheduler.matchesCategory({ courseCategory: "\u516c\u5171\u8bfe", courseNature: "\u5fc5\u4fee" }, "public-required"), true);
  assert.equal(scheduler.matchesCategory({ courseCategory: "\u4e13\u4e1a\u8bfe\u7a0b", courseNature: "\u9009\u4fee" }, "professional-elective"), true);
  assert.equal(scheduler.matchesCategory({ courseCategory: "\u4e13\u4e1a\u6838\u5fc3\u8bfe", courseNature: "\u5fc5\u4fee" }, "professional-required"), true);
  assert.equal(scheduler.matchesCategory({ courseCategory: "\u7efc\u5408\u9009\u4fee\u8bfe", courseNature: "\u9009\u4fee" }, "public-elective"), false);
  assert.equal(scheduler.matchesCategory({ courseCategory: "\u4f53\u80b2\u8bfe\u7a0b" }, "sports"), true);
  assert.equal(scheduler.matchesCategory({ courseName: "MOOC\u5927\u5b66\u82f1\u8bed", rawText: "MOOC" }, "mooc"), true);
});

test("rejects conflicting teaching classes", () => {
  const result = scheduler.generatePlans([
    course("A", time(ZH.tue, "3-4")),
    course("B", time(ZH.tue, "3-4")),
    course("B", time(ZH.wed, "3-4"))
  ], "compact", 3);
  assert.ok(result.plans.length > 0);
  const selectedB = result.plans[0].courses.find((item) => item.courseName === "B");
  assert.equal(scheduler.compactTime(selectedB), "\u5468\u4e09 3-4\u8282");
});

test("drops conflicting courses and maximizes the number of selected courses", () => {
  const result = scheduler.generatePlans([
    course("A", time(ZH.tue, "3-4")),
    course("B", time(ZH.tue, "3-4")),
    course("C", time(ZH.wed, "5-6"))
  ], "compact", 1);
  assert.equal(result.plans[0].metrics.selectedCount, 2);
  assert.equal(result.plans[0].courses.some((item) => item.courseName === "C"), true);
  assert.equal(result.plans[0].skippedCourses.length, 1);
});

test("max-courses strategy only prioritizes the number of selected courses", () => {
  const result = scheduler.generatePlans([
    course("A", time(ZH.tue, "3-4")),
    course("B", time(ZH.tue, "3-4")),
    course("C", time(ZH.wed, "5-6"))
  ], "max-courses", 1);
  assert.equal(result.plans[0].metrics.selectedCount, 2);
});

test("orders otherwise equal plans by comprehensive score", () => {
  const result = scheduler.generatePlans([
    course("A", time(ZH.tue, "1-2")),
    course("A", time(ZH.tue, "3-4")),
    course("B", time(ZH.wed, "5-6"))
  ], "max-courses", 2);
  assert.equal(result.plans.length, 2);
  assert.ok(result.plans[0].metrics.score.total >= result.plans[1].metrics.score.total);
  assert.equal(result.plans[0].id, 1);
  assert.match(result.plans[0].label, /^方案 1 /);
});

test("advanced constraints limit days and evening periods", () => {
  const result = scheduler.generatePlans([
    course("A", time(ZH.mon, "3-4")),
    course("B", time(ZH.tue, "11-12")),
    course("B", time(ZH.mon, "5-6"))
  ], "max-courses", 1, { maxDays: 1, acceptEvening: false, eveningPolicy: "allow", earlyPolicy: "allow" });
  assert.equal(result.plans[0].metrics.selectedCount, 2);
  assert.equal(result.plans[0].courses.some((item) => scheduler.compactTime(item) === "\u5468\u4e00 5-6\u8282"), true);
});

test("compact strategy minimizes class days and prefers Monday plus Friday free", () => {
  const result = scheduler.generatePlans([
    course("A", time(ZH.mon, "3-4")),
    course("A", time(ZH.wed, "3-4")),
    course("B", time(ZH.tue, "5-6"))
  ], "compact", 2);
  const selectedA = result.plans[0].courses.find((item) => item.courseName === "A");
  assert.equal(scheduler.compactTime(selectedA), "\u5468\u4e09 3-4\u8282");
  assert.equal(result.plans[0].metrics.mondayAndFridayFree, true);
  assert.deepEqual(result.plans[0].metrics.freeWeekdayNames, ["\u5468\u4e00", "\u5468\u56db", "\u5468\u4e94"]);
});

test("two midweek free days outrank one Friday free", () => {
  const result = scheduler.generatePlans([
    course("A", time(ZH.fri, "3-4")),
    course("A", `${time(ZH.tue, "3-4")};${time("\u661f\u671f\u56db", "3-4")}`),
    course("B", time(ZH.mon, "5-6")),
    course("C", time(ZH.wed, "5-6"))
  ], "compact", 2);
  const selectedA = result.plans[0].courses.find((item) => item.courseName === "A");
  assert.equal(scheduler.compactTime(selectedA), "\u5468\u4e94 3-4\u8282");
  assert.equal(result.plans[0].metrics.freeWeekdays, 2);
});

test("no-early strategy avoids periods one and two before minimizing days", () => {
  const result = scheduler.generatePlans([
    course("A", time(ZH.tue, "1-2")),
    course("A", time(ZH.wed, "3-4")),
    course("B", time(ZH.tue, "3-4"))
  ], "no-early", 2);
  const selectedA = result.plans[0].courses.find((item) => item.courseName === "A");
  assert.equal(scheduler.compactTime(selectedA), "\u5468\u4e09 3-4\u8282");
  assert.equal(result.plans[0].metrics.earlySessions, 0);
});

test("scores plans by weighted comfort metrics", () => {
  const early = scheduler.scorePlan({
    classDays: 4,
    selectedCount: 8,
    earlyStartDays: 4,
    earlySessions: 4,
    lateStartDays: 0,
    eveningDays: 0,
    eveningSessions: 0,
    density: 1,
    selectedCredits: 16
  }, 8, 16);
  const late = scheduler.scorePlan({
    classDays: 5,
    selectedCount: 8,
    earlyStartDays: 0,
    earlySessions: 0,
    lateStartDays: 5,
    eveningDays: 0,
    eveningSessions: 0,
    density: 1,
    selectedCredits: 16
  }, 8, 16);
  assert.equal(early.weights.classDays, 35);
  assert.equal(early.weights.courseCount, 25);
  assert.equal(early.weights.credits, 15);
  assert.ok(early.earlyComfort < late.earlyComfort);
  assert.ok(Number.isFinite(early.total));
});
