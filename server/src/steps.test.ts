import assert from 'node:assert/strict'
import test from 'node:test'
import { extractSteps } from './jobs.ts'

// 真实日志片段：mmdebstrap 在每个钩子后会打一行 "done"，这行以前会被
// 当成「完成」阶段，时间线于是在构建中途就显示完成。
const LOG = `I: running --setup-hook in shell: ...
done
I: running apt-get update...
I: downloading packages...
I: extracting archives...
I: installing essential packages...
done
I: running --customize-hook in shell: ...
Image generation finished at Mon Nov 2 09:54:38 UTC 2026
Deploy succeeded!
`

test('stage parsing ignores per-hook "done" lines', () => {
  const steps = extractSteps(LOG, [])
  const names = steps.map((s) => s.name)
  assert.ok(!names.includes('完成'), `不该出现「完成」，实际: ${names.join(' / ')}`)
  assert.deepEqual(names, ['执行 setup 钩子', '更新 apt 索引', '下载软件包', '解包', '安装基础系统', '执行 customize 钩子', '生成磁盘镜像'])
})

test('the same stage is only recorded once', () => {
  const first = extractSteps(LOG, [])
  const again = extractSteps(LOG, first.map((s) => ({ ...s, at: 0 })))
  assert.equal(again.length, 0, `重复解析不应新增阶段，实际: ${again.map((s) => s.name).join(' / ')}`)
})
