import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  defaultProduct,
  normalizeForProduct,
  type Catalog,
  type EnvStatus,
  type Profile,
} from '@rsdk-webui/shared'
import { comboKey, type BoardVerdicts } from '@rsdk-webui/shared'
import {
  api,
  currentMode,
  detectMode,
  disconnect,
  getSession,
  loadStoredSession,
  onSessionChange,
  resetBackend,
  type GhSession,
} from './api.ts'
import { Connect } from './views/Connect.tsx'
import { BackendStep } from './steps/Backend.tsx'
import { HooksStep } from './steps/Hooks.tsx'
import { PackagesStep } from './steps/Packages.tsx'
import { ReposStep } from './steps/Repos.tsx'
import { ReviewStep } from './steps/Review.tsx'
import { SystemStep } from './steps/System.tsx'
import { TargetStep } from './steps/Target.tsx'
import type { StepProps } from './steps/types.ts'
import { Button, Chip, Note, StatusPill } from './ui.tsx'
import { JobView } from './views/JobView.tsx'
import { JobsView } from './views/JobsView.tsx'
import { PreviewPanel } from './views/PreviewPanel.tsx'
import { SetupView } from './views/SetupView.tsx'

const STEPS = [
  { id: 'target', label: '开发板与系统', hint: '选板子' },
  { id: 'repos', label: '软件源', hint: '镜像' },
  { id: 'packages', label: '软件包', hint: '加包' },
  { id: 'system', label: '系统配置', hint: '用户' },
  { id: 'hooks', label: '覆盖与脚本', hint: '文件' },
  { id: 'backend', label: '构建后端', hint: '在哪跑' },
  { id: 'review', label: '确认构建', hint: '开始' },
]

type Route = { kind: 'wizard' } | { kind: 'jobs' } | { kind: 'job'; id: string } | { kind: 'setup' }

export default function App() {
  const [env, setEnv] = useState<EnvStatus | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [step, setStep] = useState('target')
  const [route, setRoute] = useState<Route>({ kind: 'wizard' })
  const [preview, setPreview] = useState(false)
  const [saved, setSaved] = useState<Profile[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [mode, setMode] = useState<'server' | 'static' | null>(null)
  const [session, setSession] = useState<GhSession | null>(null)
  const [verdicts, setVerdicts] = useState<BoardVerdicts | null>(null)
  const [welcomeOff, setWelcomeOff] = useState(() => localStorage.getItem('rsdk-webui.welcome') === 'off')

  const refreshEnv = useCallback(async () => {
    try {
      const e = await api.env()
      setEnv(e)
      return e
    } catch (err) {
      setFatal(String(err instanceof Error ? err.message : err))
      return null
    }
  }, [])

  const bootstrap = useCallback(async () => {
    const e = await refreshEnv()
    try {
      const c = await api.catalog()
      setCatalog(c)
      const fresh = await api.newProfile(defaultProduct(c.products)?.product)
      setProfile((prev) => prev ?? fresh)
    } catch (err) {
      setFatal(String(err instanceof Error ? err.message : err))
    }
    void e
    api.profiles().then(setSaved).catch(() => undefined)
  }, [refreshEnv])

  useEffect(() => {
    void (async () => {
      const detected = await detectMode()
      setMode(detected)
      // deploy-time board verdicts (only the static build ships them)
      fetch('boards.json')
        .then((r) => (r.ok ? (r.json() as Promise<BoardVerdicts>) : null))
        .then(setVerdicts)
        .catch(() => undefined)
      if (detected === 'static') {
        setSession(loadStoredSession())
      }
    })()
  }, [])

  // static mode: everything depends on having a session, so (re)load when it
  // appears or disappears
  useEffect(() => {
    if (mode === null) return
    if (mode === 'static' && !session) {
      setProfile(null)
      setCatalog(null)
      return
    }
    void bootstrap()
  }, [mode, session, bootstrap])

  useEffect(() => onSessionChange(setSession), [])

  const patch = useCallback((p: Partial<Profile>) => {
    setProfile((prev) => (prev ? { ...prev, ...p } : prev))
  }, [])

  const setForProduct = useCallback((next: Profile) => {
    const product = catalog?.products.find((p) => p.product === next.target.product)
    return normalizeForProduct(next, product)
  }, [catalog])

  const removeProfile = async (target: Profile) => {
    if (!confirm(`删除方案「${target.meta.name}」？此操作不可撤销。`)) return
    try {
      await api.deleteProfile(target.id)
      setSaved(await api.profiles())
      // if it was the one being edited, start from a clean slate rather than
      // keeping an unsaved copy around
      if (profile?.id === target.id) {
        setProfile(setForProduct(await api.newProfile()))
        setStep('target')
      }
    } catch (err) {
      setToast(String(err instanceof Error ? err.message : err))
    }
  }

  const save = async () => {
    if (!profile) return
    try {
      // the backend may normalise (e.g. clamp suite/edition to what the board
      // supports) - apply what it actually stored
      setProfile(await api.saveProfile(profile))
      setSaved(await api.profiles())
      setToast('方案已保存')
      setTimeout(() => setToast(null), 2200)
    } catch (err) {
      setToast(String(err instanceof Error ? err.message : err))
    }
  }

  const statusChip = useMemo(() => {
    if (mode === 'static') {
      return session ? (
        <>
          <Chip tone="info">GitHub Pages</Chip>
          <Chip tone="accent">{session.repo}</Chip>
        </>
      ) : (
        <Chip>GitHub Pages</Chip>
      )
    }
    if (!env) return <Chip>检测中…</Chip>
    if (!env.engine.ok) return <Chip tone="danger">无容器引擎</Chip>
    if (!env.image.present) return <Chip tone="warn">镜像未导入</Chip>
    if (!env.buildTree.ready) return <Chip tone="danger">构建树不可用</Chip>
    return <Chip tone="accent">{env.engine.kind} · rsdk {env.buildTree.rsdkVersion ?? '?'}</Chip>
  }, [env, mode, session])

  useEffect(() => {
    if (route.kind === 'wizard' && window.innerWidth <= 860) {
      document.querySelector('.rail .step.active')?.scrollIntoView({ block: 'nearest', inline: 'center' })
    }
  }, [step, route.kind, mode, session])

  // 换步骤时回到内容顶部，别让用户在半空中找标题
  useEffect(() => {
    document.querySelector('.main')?.scrollTo({ top: 0 })
  }, [step])

  // 未保存的修改：与 localStorage / 服务端里的同 id 方案对比。
  // 没保存过的新方案也算「脏」，不然用户不知道切走会丢。
  // 注意：这两个 hook 必须放在下面所有 early return 之前 —— 一旦某次渲染
  // 提前返回（无 catalog / 未连接 GitHub），hook 数量就会变，React #300。
  const dirty = useMemo(() => {
    if (!profile) return false
    const stored = saved.find((p) => p.id === profile.id)
    if (!stored) return true
    return JSON.stringify(stored) !== JSON.stringify(profile)
  }, [profile, saved])

  // 刷新 / 关闭标签页的兜底（没有自动草稿，这层提示是唯一的防线）
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (mode === 'static' && !session) {
    return (
      <div className="app connect-app">
        <header className="topbar">
          <div className="brand">
            <span className="dot" />
            rsdk-webui
            <small>GitHub Pages · 静态模式</small>
          </div>
          <div className="spacer" />
          <Chip tone="info">无后端</Chip>
        </header>
        <nav className="rail" />
        <main className="main">
          <Connect
            onConnected={(next) => {
              resetBackend()
              setSession(next)
            }}
          />
        </main>
      </div>
    )
  }

  if (fatal && !catalog) {
    return (
      <div className="app">
        <div className="topbar">
          <div className="brand">
            <span className="dot" />
            rsdk-webui
          </div>
        </div>
        <div className="rail" />
        <div className="main">
          <Note tone="danger">
            <b>读不到 rsdk 元数据</b>
            <div className="mono" style={{ marginTop: 6, fontSize: 12 }}>
              {fatal}
            </div>
            <div style={{ marginTop: 10 }}>
              板子列表、jsonnet 树都从 rsdk 容器镜像里导出，本机没有可用的 podman/docker
              时取不到。两条路：装一个容器引擎后重试；或者不装任何东西，直接用 GitHub
              Pages 上的静态版（构建交给 GitHub Actions）。
            </div>
            <div style={{ marginTop: 12 }}>
              <Button onClick={() => void bootstrap()}>重试</Button>
              <Button variant="ghost" onClick={() => setRoute({ kind: 'setup' })}>
                打开环境准备
              </Button>
            </div>
          </Note>
          {route.kind === 'setup' && (
            <div style={{ marginTop: 16 }}>
              <SetupView
                mode={mode ?? 'server'}
                env={env}
                onRefresh={() => void refreshEnv()}
                onOpenJob={(id) => setRoute({ kind: 'job', id })}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  const stepProps: StepProps | null = profile
    ? {
        mode: mode ?? 'server',
        verdicts,
        profile,
        patch,
        catalog,
        env,
        goto: (target) => {
          if (target.startsWith('job:')) setRoute({ kind: 'job', id: target.slice(4) })
          else if (target === 'setup') setRoute({ kind: 'setup' })
          else setStep(target)
        },
      }
    : null

  const stepIndex = STEPS.findIndex((s) => s.id === step)

  // 切换方案 / 新建都会整体替换 profile —— 先拦一道，别让编辑静默消失
  const confirmDiscard = () =>
    !dirty || confirm('当前方案有未保存的修改，继续会丢失这些改动。要继续吗？')

  const currentVerdict = profile
    ? verdicts?.combos[comboKey(profile.target.product, profile.target.suite, profile.target.edition)]
    : undefined

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          rsdk-webui
          <small>RadxaOS 镜像定制</small>
        </div>
        <div className="spacer" />
        {statusChip}
        <Button size="sm" variant={route.kind === 'wizard' ? 'primary' : 'ghost'} onClick={() => setRoute({ kind: 'wizard' })}>
          定制
        </Button>
        <Button size="sm" variant={route.kind === 'jobs' || route.kind === 'job' ? 'primary' : 'ghost'} onClick={() => setRoute({ kind: 'jobs' })}>
          构建记录
        </Button>
        <Button size="sm" variant={route.kind === 'setup' ? 'primary' : 'ghost'} onClick={() => setRoute({ kind: 'setup' })}>
          {mode === 'static' ? '构建仓库' : '环境准备'}
        </Button>
        {mode === 'static' && session && (
          <Button
            size="sm"
            variant="ghost"
            title={`已连接 ${session.login} · 点击断开`}
            onClick={() => {
              disconnect()
              resetBackend()
              setSession(null)
            }}
          >
            断开 {session.login}
          </Button>
        )}
        {route.kind === 'wizard' && (
          <Button size="sm" variant={preview ? 'primary' : 'ghost'} onClick={() => setPreview((v) => !v)}>
            预览生成物
          </Button>
        )}
      </header>

      <nav className="rail" aria-label="页面导航">
        {route.kind === 'wizard' ? (
          <>
            <h4>定制流程</h4>
            <div className="rail-steps">
              {STEPS.map((s, i) => (
                <button
                  key={s.id}
                  className={`step${s.id === step ? ' active' : ''}`}
                  aria-current={s.id === step ? 'step' : undefined}
                  onClick={() => setStep(s.id)}
                >
                  <span className="num">{i + 1}</span>
                  <span className="label">{s.label}</span>
                </button>
              ))}
            </div>
            <h4 style={{ marginTop: 18 }}>已保存方案</h4>
            <div className="rail-profile-actions">
              <Button
                size="sm"
                onClick={async () => {
                  if (!confirmDiscard()) return
                  const next = await api.newProfile()
                  setProfile(setForProduct(next))
                  setStep('target')
                }}
              >
                新建
              </Button>
              <Button
                size="sm"
                variant={dirty ? 'primary' : 'ghost'}
                title={dirty ? '有未保存的修改' : '方案已保存'}
                onClick={() => void save()}
                disabled={!profile}
              >
                保存{dirty ? ' ●' : ''}
              </Button>
            </div>
            {saved.length === 0 && <p className="faint rail-empty">还没有保存过</p>}
            {saved.map((p) => (
              <div className="saved-profile-row" key={p.id}>
                <button
                  className={`step saved-profile${profile?.id === p.id ? ' active' : ''}`}
                  onClick={() => {
                    if (!confirmDiscard()) return
                    setProfile(setForProduct(p))
                  }}
                  title={`${p.meta.name} · ${p.target.product} · ${p.target.suite}/${p.target.edition}`}
                  aria-label={`打开方案 ${p.meta.name}，${p.target.product}，${p.target.suite}/${p.target.edition}`}
                >
                  <span className="num">◆</span>
                  <span className="profile-text"><span className="label">{p.meta.name}</span><small>{p.target.product} · {p.target.suite}</small></span>
                </button>
                <button
                  className="profile-delete"
                  title={`删除方案「${p.meta.name}」`}
                  aria-label={`删除方案 ${p.meta.name}`}
                  onClick={() => void removeProfile(p)}
                >
                  ×
                </button>
              </div>
            ))}
          </>
        ) : (
          <>
            <h4>导航</h4>
            <button className="step" onClick={() => setRoute({ kind: 'wizard' })}>
              <span className="num">←</span>
              <span className="label">返回定制</span>
            </button>
          </>
        )}
      </nav>

      <main className="main">
        {toast && (
          <div style={{ position: 'sticky', top: 0, zIndex: 5 }}>
            <Note tone="ok">{toast}</Note>
          </div>
        )}

        {currentVerdict && currentVerdict.status !== 'ok' && route.kind === 'wizard' && (
          <div style={{ marginBottom: 16 }}>
            <Note tone={currentVerdict.status === 'broken' ? 'danger' : 'warn'}>
              <b>
                {profile?.target.product} / {profile?.target.suite} / {profile?.target.edition}
                {currentVerdict.status === 'broken' ? ' 上游无法构建' : ' 需要测试源'}
              </b>
              <div style={{ marginTop: 4 }}>{currentVerdict.hint}</div>
              {currentVerdict.missing && currentVerdict.missing.length > 0 && (
                <div className="mono" style={{ marginTop: 4, fontSize: 11.5 }}>
                  {currentVerdict.missing.join(' · ').slice(0, 220)}
                </div>
              )}
            </Note>
          </div>
        )}

        {route.kind === 'setup' && (
          <SetupView
            mode={mode ?? 'server'}
            env={env}
            onRefresh={() => void refreshEnv()}
            onOpenJob={(id) => setRoute({ kind: 'job', id })}
            onGotoBackend={() => {
              setRoute({ kind: 'wizard' })
              setStep('backend')
            }}
          />
        )}

        {route.kind === 'jobs' && (
          <JobsView onOpen={(id) => setRoute({ kind: 'job', id })} onCompose={() => setRoute({ kind: 'wizard' })} />
        )}

        {route.kind === 'job' && (
          <JobView
            jobId={route.id}
            onBack={() => setRoute({ kind: 'jobs' })}
            onOpenJob={(id) => setRoute({ kind: 'job', id })}
          />
        )}

        {route.kind === 'wizard' && (
          <div className={`wizard-layout${preview ? ' with-preview' : ''}`}>
            <div>
              {!welcomeOff && saved.length === 0 && step === 'target' && (
                <div className="welcome">
                  <span>
                    第一次用？每步都有默认值，拿不准就保持默认；右侧「预览生成物」随时能看最终产物。
                  </span>
                  <button
                    type="button"
                    aria-label="关闭提示"
                    onClick={() => {
                      setWelcomeOff(true)
                      localStorage.setItem('rsdk-webui.welcome', 'off')
                    }}
                  >
                    知道了
                  </button>
                </div>
              )}
              <div className="page-head">
                <div>
                  <span className="step-meta">
                    第 {String(stepIndex + 1).padStart(2, '0')} 步 / 共 {STEPS.length} 步
                  </span>
                  <h1>{STEPS[stepIndex]?.label}</h1>
                  <p>
                    {step === 'target' && '选一块板子，确认系统版本和扇区大小。'}
                    {step === 'repos' && '选从哪取包。Radxa 源不是每个镜像站都有。'}
                    {step === 'packages' && '在预置套装之外，加装或移除软件包。'}
                    {step === 'system' && '设置主机名、时区、用户、SSH 和 Wi-Fi。'}
                    {step === 'hooks' && '放自己的文件，或加一段构建时脚本。'}
                    {step === 'backend' && '选在哪构建：本机容器，或 GitHub Actions。'}
                    {step === 'review' && '确认无误后开始构建。预检会先报缺包。'}
                  </p>
                </div>
              </div>

              {!profile && (
                <div className="card">
                  <div className="empty">
                    {fatal ? (
                      <>
                        <div>读取 rsdk 元数据失败。</div>
                        <div className="faint mono" style={{ marginTop: 8, fontSize: 11.5 }}>
                          {fatal}
                        </div>
                        <div style={{ marginTop: 12 }}>
                          <Button onClick={() => void bootstrap()}>重试</Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="spin" style={{ width: 18, height: 18, borderWidth: 3 }} />
                        <div style={{ marginTop: 12 }}>正在读取 rsdk 元数据…</div>
                        <div className="faint" style={{ marginTop: 6, fontSize: 12 }}>
                          {mode === 'static'
                            ? '正在向 GitHub 确认仓库状态…'
                            : '第一次要从 rsdk 镜像里导出板子列表，稍等。'}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {profile && stepProps && (
                <>
                  {step === 'target' && <TargetStep {...stepProps} />}
                  {step === 'repos' && <ReposStep {...stepProps} />}
                  {step === 'packages' && <PackagesStep {...stepProps} />}
                  {step === 'system' && <SystemStep {...stepProps} />}
                  {step === 'hooks' && <HooksStep {...stepProps} />}
                  {step === 'backend' && <BackendStep {...stepProps} />}
                  {step === 'review' && <ReviewStep {...stepProps} />}

                  <div className="actions">
                    <Button disabled={stepIndex === 0} onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)].id)}>
                      ← 上一步
                    </Button>
                    {stepIndex < STEPS.length - 1 ? (
                      <Button variant="primary" onClick={() => setStep(STEPS[stepIndex + 1].id)}>
                        下一步：{STEPS[stepIndex + 1].label} →
                      </Button>
                    ) : (
                      <span className="faint" style={{ alignSelf: 'center' }}>
                        向导到这里就完了 —— 构建按钮在「开始构建」卡片里
                      </span>
                    )}
                    <div className="spacer" />
                    <span className="faint mono" style={{ fontSize: 11.5 }}>
                      {profile.id} · {profile.target.product}/{profile.target.suite}/{profile.target.edition}
                    </span>
                  </div>
                </>
              )}
            </div>

            {preview && profile && <PreviewPanel profile={profile} onClose={() => setPreview(false)} />}
          </div>
        )}
      </main>
    </div>
  )
}
