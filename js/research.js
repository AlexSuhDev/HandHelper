(function (global) {
  'use strict';
  const HH = global.HandHelper;
  const clusterFor = (model, features) => HH.nearest(HH.vector(features).map((v, i) => (v - model.means[i]) / model.scales[i]), model.centers);
  function trainStudy(dataset) {
    if (!dataset || !['synthetic', 'observation'].includes(dataset.source) || !Array.isArray(dataset.rows) || dataset.rows.length < 100 || dataset.rows.length > 10000) throw new Error('Исследовательская выборка: 100–10 000 размеченных сессий.');
    if (typeof dataset.referenceMethod !== 'string' || dataset.referenceMethod.trim().length < 10 || dataset.referenceMethod.length > 1000) throw new Error('Опишите способ независимого определения меток (referenceMethod).');
    const participants = new Map();
    for (const row of dataset.rows) {
      HH.vector(row.features);
      if (typeof row.participantId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(row.participantId) || ![0, 1, 2, 3].includes(row.severity)) throw new Error('Нужны обезличенный participantId и severity 0–3.');
      if (!participants.has(row.participantId)) participants.set(row.participantId, { id: row.participantId, severity: row.severity, rows: [] });
      const participant = participants.get(row.participantId);
      if (participant.severity !== row.severity) throw new Error('Противоречивые метки одного участника. Для продольного исследования нужна отдельная схема.');
      participant.rows.push(row);
    }
    const random = HH.rng(271828), train = [], test = [], trainIds = [], testIds = [];
    for (let severity = 0; severity < 4; severity++) {
      const group = Array.from(participants.values()).filter(p => p.severity === severity);
      if (group.length < 5) throw new Error('Нужно минимум 5 разных участников для каждой из четырёх меток.');
      for (let i = group.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [group[i], group[j]] = [group[j], group[i]]; }
      const cutoff = Math.max(1, Math.floor(group.length * 0.2));
      group.forEach((p, i) => { (i < cutoff ? test : train).push(...p.rows); (i < cutoff ? testIds : trainIds).push(p.id); });
    }
    // Fit scaler and centroids on the training participants only.
    const model = HH.fit(train.map(r => r.features), { synthetic: dataset.source === 'synthetic' });
    const votes = model.centers.map(() => [0, 0, 0, 0]);
    // Give each training participant equal total weight, even with repeated sessions.
    train.forEach(row => { votes[clusterFor(model, row.features)][row.severity] += 1 / participants.get(row.participantId).rows.length; });
    model.levels = votes.map(v => {
      const total = v.reduce((s, x) => s + x, 0), max = Math.max(...v);
      return total > 0 && max / total >= 0.6 && v.filter(x => x === max).length === 1 ? v.indexOf(max) : null;
    });
    const matrix = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    let abstained = 0, correct = 0;
    const byParticipant = new Map();
    for (const row of test) {
      const report = HH.exampleReport(0); report.features = row.features;
      const result = HH.predict(model, report);
      if (!byParticipant.has(row.participantId)) byParticipant.set(row.participantId, { total: 0, correct: 0 });
      const item = byParticipant.get(row.participantId); item.total++;
      if (result.status !== 'ok') { abstained++; continue; }
      matrix[row.severity][result.level]++;
      if (result.level === row.severity) { correct++; item.correct++; }
    }
    const recall = matrix.map((row, i) => {
      const total = test.filter(r => r.severity === i).length;
      return total ? row[i] / total : null;
    });
    model.study = { referenceMethod: dataset.referenceMethod.trim(), clinicalValidation: false, trainingParticipants: trainIds.length, testParticipants: testIds.length };
    const precision = matrix.map((_, i) => { const predicted = matrix.reduce((s, row) => s + row[i], 0); return predicted ? matrix[i][i] / predicted : null; });
    const f1 = precision.map((p, i) => p === null || p + recall[i] === 0 ? 0 : 2 * p * recall[i] / (p + recall[i]));
    const positives = test.filter(r => r.severity > 0).length, negatives = test.length - positives;
    const binarySensitivity = positives ? matrix.slice(1).reduce((s, row) => s + row.slice(1).reduce((a, b) => a + b, 0), 0) / positives : null;
    const binarySpecificity = negatives ? matrix[0][0] / negatives : null;
    const evaluation = { version: 2, source: dataset.source, clinicalValidation: false, referenceMethod: dataset.referenceMethod.trim(), trainIds, testIds, trainingParticipants: trainIds.length, testParticipants: testIds.length, trainSessions: train.length, testSessions: test.length, confusionMatrix: matrix, abstained, coverage: (test.length - abstained) / test.length, accuracyIncludingAbstentions: correct / test.length, participantBalancedAccuracy: Array.from(byParticipant.values()).reduce((s, p) => s + p.correct / p.total, 0) / byParticipant.size, recall, balancedAccuracy: recall.reduce((s, x) => s + x, 0) / 4, clusterLabels: model.levels };
    Object.assign(evaluation, { precision, f1, macroF1: f1.reduce((a, b) => a + b, 0) / 4, binarySensitivity, binarySpecificity, falsePositiveRate: negatives ? matrix[0].slice(1).reduce((a, b) => a + b, 0) / negatives : null });
    return { model, evaluation };
  }
  function studyExample() {
    const rows = HH.syntheticRows().map((features, i) => ({ participantId: 'demo_' + Math.floor(i / 5), severity: Math.floor(i / 100), features }));
    return { version: 2, source: 'synthetic', referenceMethod: 'СИНТЕТИЧЕСКИЕ метки для проверки программы. Не медицинские данные.', rows };
  }
  global.HandHelper.trainStudy = trainStudy;
  global.HandHelper.studyExample = studyExample;
})(globalThis);
