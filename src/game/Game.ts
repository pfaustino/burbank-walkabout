import * as THREE from 'three'
import busesJson from '../../data/buses.json'
import deliveryJson from '../../data/delivery.json'
import businessesJson from '../../data/businesses.json'
import crowdJson from '../../data/crowd.json'
import foliageJson from '../../data/foliage.json'
import mapJson from '../../data/map.json'
import peopleJson from '../../data/people.json'
import trafficJson from '../../data/traffic.json'
import { CrowdSet } from '../actors/CrowdSet.ts'
import { CROWD_SEED, createCrowd, crowdId, crowdIndex, crowdPose, type CrowdFile, type CrowdWorld } from '../actors/crowdSim.ts'
import { createPeople, stepPeople, type PeopleFile, type PersonSim } from '../actors/peopleSim.ts'
import { PuppetSet } from '../actors/PuppetSet.ts'
import { Ambience } from '../audio/ambience.ts'
import { DeliveryRun } from '../delivery/DeliveryRun.ts'
import type { DeliveryFile } from '../delivery/orders.ts'
import { mountDevPanel } from '../dev/DevPanel.ts'
import { CityClient, clientUrl } from '../net/Client.ts'
import type { NetCarRide, NetPerson, NetPlayer, SpeechMsg } from '../net/protocol.ts'
import { Walker } from '../player/Walker.ts'
import { BusSet } from '../traffic/BusSet.ts'
import { CarSet } from '../traffic/CarSet.ts'
import {
  BUS_HALF_LENGTH,
  BUS_HALF_WIDTH,
  CAR_HALF_LENGTH,
  CAR_HALF_WIDTH,
  PERSON_RADIUS,
  type Disc,
} from '../traffic/bodies.ts'
import { createBuses, stepBuses, type BusFile, type BusSim } from '../traffic/busSim.ts'
import { buildNetwork, type RoadNetwork } from '../traffic/network.ts'
import { buildSigns, disposeDrawn, setSignGlow } from '../traffic/streetProps.ts'
import { bumpCars } from '../traffic/bumps.ts'
import { createTraffic, parkOnLane, stepTraffic, type CarSim, type TrafficFile } from '../traffic/trafficSim.ts'
import { Hud } from '../ui/Hud.ts'
import { Minimap } from '../ui/Minimap.ts'
import { WordRain } from '../ui/WordRain.ts'
import { createSeededRng } from '../util/seededRng.ts'
import { listen, playMp3, speak, type ListenHandle } from '../voice/speech.ts'
import { buildCityMesh } from '../world/CityMesh.ts'
import { advanceHour, formatHour, skyAt, START_HOUR } from '../world/daylight.ts'
import { buildFoliage } from '../world/FoliageMesh.ts'
import { type FoliageFile } from '../world/foliage.ts'
import { Helicopter } from '../world/Helicopter.ts'
import { tourOver } from '../world/helicopterSim.ts'
import { buildLayout, describePlace, nearbySpot, type CityLayout, type MapFile } from '../world/layout.ts'
import { StreetLamps } from '../world/streetlamps.ts'
import { buildStoreSigns, disposeStoreSigns, type Business } from '../world/storefronts.ts'

const WALK_HINT = 'WASD walk · Shift run · right-drag look · Space hop · E talk · V mic · F drive or ride · H helicopter'
const DRIVE_HINT = 'WASD drive · A/D steer · Shift faster · F park'
const RIDE_HINT = 'Riding the bus · F to hop off'
const FLY_HINT = 'WASD fly · A/D turn · Space up · C down · Shift faster · H land'

export class Game {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly timer = new THREE.Timer()
  private readonly layout: CityLayout
  private readonly peopleFile: PeopleFile
  private readonly hud: Hud
  private readonly walker: Walker
  private readonly citizensView: PuppetSet
  private readonly walkersView: PuppetSet
  private readonly network: RoadNetwork
  private readonly busFile: BusFile
  private readonly buses: BusSim[]
  private readonly busView: BusSet
  private readonly busRng: () => number
  private readonly trafficFile: TrafficFile
  private readonly cars: CarSim[]
  private readonly carView: CarSet
  private readonly carRng: () => number
  private readonly signs: THREE.Group
  private drivenId: string | null = null
  private riddenId: string | null = null
  private readonly crowd: CrowdWorld
  private readonly crowdView: CrowdSet
  private readonly foliage: { root: THREE.Group; update(time: number): void; dispose(): void }
  private readonly helicopter: Helicopter
  private readonly minimap: Minimap
  private readonly delivery: DeliveryRun
  private readonly wordnet = new WordRain()
  private readonly client: CityClient
  private readonly sun: THREE.DirectionalLight
  private readonly sunTarget = new THREE.Object3D()
  private readonly hemi: THREE.HemisphereLight
  private readonly skyColor = new THREE.Color(0x8ec6ea)
  private readonly fog: THREE.Fog
  private readonly storefronts: THREE.Group
  private readonly lamps: StreetLamps
  private readonly ambience = new Ambience()
  private dayHour = START_HOUR
  private stepX = 0
  private stepZ = 0
  private readonly rng: () => number
  private sim: PersonSim[]
  private citizens: NetPerson[] = []
  private remotes: NetPlayer[] = []
  private live = false
  private hear = true
  private paused = false
  private time = 0
  private readonly held = new Set<string>()
  private readonly crowdFreeze = new Map<number, number>()
  private readonly vehicleDiscs: Disc[] = []
  private readonly personDiscs: Disc[] = []
  private readonly blockers: Disc[] = []
  private readonly walkerHold: Disc[] = []
  private readonly puppetHold: Disc[] = []
  private readonly remoteIds = new Set<string>()
  private readonly crowdHold: Disc[] = []
  private readonly trafficHold: Disc[] = []
  private readonly busHold: Disc[] = []
  private readonly footDisc: Disc = { x: 0, z: 0, r: PERSON_RADIUS, id: 'you' }
  private running = false
  private mic: ListenHandle | null = null

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    const tag = (event.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (event.code === 'Escape') (event.target as HTMLElement).blur()
      return
    }
    if (event.repeat) return
    this.ambience.resume()
    if (event.code === 'Escape') {
      this.paused = !this.paused
      this.walker.paused = this.paused
      this.hud.setPaused(this.paused)
      return
    }
    if (this.paused) return
    if (event.code === 'KeyE') {
      event.preventDefault()
      this.hud.focusTalk()
    } else if (event.code === 'KeyV') {
      this.toggleMic()
    } else if (event.code === 'KeyH') {
      event.preventDefault()
      this.toggleHeli()
    } else if (event.code === 'KeyF') {
      event.preventDefault()
      this.toggleVehicle()
    }
  }

  private readonly onPointer = (): void => {
    this.canvas.focus()
    this.ambience.resume()
  }

  private readonly onContext = (event: Event): void => {
    event.preventDefault()
  }

  constructor(canvas: HTMLCanvasElement, playerName: string, dev: boolean) {
    this.canvas = canvas
    this.layout = buildLayout(mapJson as MapFile)
    this.peopleFile = peopleJson as PeopleFile
    this.rng = createSeededRng(0xb0ba)
    this.sim = createPeople(this.layout, this.peopleFile, this.rng)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2400)
    this.scene.background = this.skyColor
    this.fog = new THREE.Fog(0x8ec6ea, 70, 900)
    this.scene.fog = this.fog

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x8a7a62, 0.9)
    this.sun = new THREE.DirectionalLight(0xfff0d0, 1.25)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    this.sun.shadow.camera.near = 10
    this.sun.shadow.camera.far = 180
    this.sun.shadow.camera.left = -55
    this.sun.shadow.camera.right = 55
    this.sun.shadow.camera.top = 55
    this.sun.shadow.camera.bottom = -55
    this.sun.shadow.bias = -0.0004
    this.sun.target = this.sunTarget
    this.scene.add(this.hemi, this.sun, this.sunTarget, buildCityMesh(this.layout))
    this.storefronts = buildStoreSigns(this.layout, businessesJson as Business[])
    this.lamps = new StreetLamps(this.layout)
    this.scene.add(this.storefronts, this.lamps.root)
    this.foliage = buildFoliage(this.layout, foliageJson as FoliageFile, createSeededRng(0xf011))
    this.scene.add(this.foliage.root)
    this.network = buildNetwork(this.layout)
    this.busFile = busesJson as BusFile
    this.busRng = createSeededRng(0xb05)
    this.buses = createBuses(this.network, this.busFile, this.busRng)
    this.busView = new BusSet(this.scene)
    this.trafficFile = trafficJson as TrafficFile
    this.carRng = createSeededRng(0xca5)
    this.cars = createTraffic(this.network, this.trafficFile, this.carRng)
    this.carView = new CarSet(this.scene)
    this.signs = buildSigns(this.network.signs)
    this.scene.add(this.signs)
    this.crowd = createCrowd(this.layout, crowdJson as CrowdFile, createSeededRng(CROWD_SEED))
    this.crowdView = new CrowdSet(this.scene, this.crowd)
    this.helicopter = new Helicopter(tourOver(this.layout.landmarks, this.layout.file.spawn))
    this.scene.add(this.helicopter.root)
    this.minimap = new Minimap(this.layout)

    this.walker = new Walker(this.layout, this.camera, this.layout.file.spawn, playerName)
    this.scene.add(this.walker.mesh)
    this.citizensView = new PuppetSet(this.scene)
    this.walkersView = new PuppetSet(this.scene)

    this.hud = new Hud({
      onSay: (text) => this.submit(text),
      onMic: () => this.toggleMic(),
      onHear: (enabled) => {
        this.hear = enabled
      },
      onPay: (which) => this.ambience.coin(which === 'tip' ? 1.18 : 1),
      coinInto: () => this.carScreen(),
    })
    this.delivery = new DeliveryRun(
      this.scene,
      this.layout,
      this.network,
      businessesJson as Business[],
      this.hud,
      createSeededRng(0xd45e),
      deliveryJson as DeliveryFile,
    )

    this.client = new CityClient(clientUrl(), playerName, {
      onPeople: (people) => {
        if (!this.live) this.citizensView.clear()
        this.live = true
        this.citizens = people
      },
      onPlayers: (players) => {
        this.remotes = players
      },
      onSpeech: (msg) => this.onSpeech(msg),
      onStatus: (text) => {
        this.hud.setNet(text)
        if ((text === 'offline' || text === 'connecting') && this.live) {
          this.live = false
          this.sim = createPeople(this.layout, this.peopleFile, this.rng)
          this.held.clear()
          this.citizensView.clear()
        }
      },
      onError: (message) => this.hud.pushLine('Street', message),
    })

    if (dev) {
      mountDevPanel({
        landmarks: this.layout.landmarks.map((mark) => ({
          name: mark.name ?? 'Place',
          x: mark.door?.[0] ?? (mark.minX + mark.maxX) / 2,
          z: mark.door?.[1] ?? (mark.minZ + mark.maxZ) / 2,
        })),
        people: this.peopleFile.people.map((person) => ({ id: person.id, name: person.name })),
        teleport: (x, z) => this.moveTo(x, z),
        meet: (id) => this.meet(id),
      })
    }

    this.canvas.tabIndex = 0
    window.addEventListener('resize', this.onResize)
    window.addEventListener('keydown', this.onKey)
    this.canvas.addEventListener('mousedown', this.onPointer)
    this.canvas.addEventListener('contextmenu', this.onContext)
    this.timer.connect(document)
    this.client.connect()
    this.stepX = this.walker.mesh.position.x
    this.stepZ = this.walker.mesh.position.z
    this.applySky()
  }

  start(): void {
    this.running = true
    this.renderer.setAnimationLoop(this.frame)
    this.canvas.focus()
    this.ambience.resume()
  }

  dispose(): void {
    this.running = false
    this.renderer.setAnimationLoop(null)
    this.timer.disconnect()
    this.mic?.stop()
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('keydown', this.onKey)
    this.canvas.removeEventListener('mousedown', this.onPointer)
    this.canvas.removeEventListener('contextmenu', this.onContext)
    this.client.dispose()
    this.walker.dispose()
    this.citizensView.dispose()
    this.walkersView.dispose()
    this.busView.dispose()
    this.carView.dispose()
    disposeDrawn(this.signs)
    this.scene.remove(this.signs)
    this.crowdView.dispose()
    this.foliage.dispose()
    this.helicopter.dispose()
    this.delivery.dispose()
    this.minimap.dispose()
    this.wordnet.dispose()
    this.scene.remove(this.foliage.root, this.helicopter.root, this.storefronts, this.lamps.root)
    disposeStoreSigns(this.storefronts)
    this.lamps.dispose()
    this.ambience.dispose()
    this.renderer.dispose()
  }

  private frame = (): void => {
    if (!this.running) return
    this.timer.update()
    const dt = Math.min(this.timer.getDelta(), 0.05)
    if (this.riddenId) {
      const bus = this.buses.find((entry) => entry.id === this.riddenId)
      if (bus) this.walker.followRide(bus.x, bus.z, bus.yaw)
      else this.leaveBus()
    }
    this.syncVehicles()
    this.syncPeople()
    this.syncBlockers()
    this.walker.blockers = this.withoutRemotes()
    this.walker.ignoreBlocker = this.drivenId ? `car:${this.drivenId}` : null
    this.walker.update(dt)
    const pos = this.walker.mesh.position
    this.time += dt
    this.copyDrivenCar(pos.x, pos.z)
    this.applyRemoteCars()
    this.releaseCrowd(pos.x, pos.z)
    this.crowdView.update(this.time, this.crowdFreeze, this.crowdBlocks())
    this.syncPeople()
    stepTraffic(this.cars, this.network, this.trafficFile, this.time, dt, this.carRng, this.trafficObstacles())
    stepBuses(this.buses, this.network, this.busFile, this.time, dt, this.busRng, this.busObstacles())
    this.syncVehicles()
    this.crowdView.nudge(this.vehicleDiscs)
    this.foliage.update(this.time)
    if (!this.walker.flying && this.helicopter.incoming) this.helicopter.aim(pos.x, pos.z)
    this.helicopter.update(dt, this.time, this.walker.flying ? this.walker.flight : null)
    if (!this.walker.flying && this.helicopter.arrived) {
      const pose = this.helicopter.pose
      this.walker.beginFly(pose.x, pose.y, pose.z, pose.yaw)
      this.helicopter.board()
      this.hud.setStatus(FLY_HINT)
    }
    this.client.sendMove(pos.x, pos.z, this.walker.facing, this.drivenRide())
    if (!this.live) {
      this.releaseHeld(pos.x, pos.z)
      stepPeople(this.sim, this.layout, this.peopleFile.speed, dt, this.rng, this.held)
      this.citizens = this.sim.map((person) => this.toNet(person))
    }
    this.syncPeople()
    this.syncBlockers()
    this.citizensView.sync(this.citizens, dt, this.blockers)
    this.walkersView.sync(
      this.remotes.filter((player) => !player.car).map((player) => ({
        id: player.id,
        name: player.name,
        voice: 'male',
        shirt: player.color,
        pants: '#243044',
        skin: '#e0b090',
        hair: '#2a2118',
        x: player.x,
        z: player.z,
        yaw: player.yaw,
      })),
      dt,
      this.withFoot(this.blockers),
    )
    if (!this.walker.flying && !this.walker.riding) this.walker.shoveOut(this.vehicleDiscs)
    this.copyDrivenCar(pos.x, pos.z)
    const hits = bumpCars(this.cars, this.layout, this.trafficFile.restitution)
    this.keepDrivenBump()
    const wall = this.walker.takeWallHit()
    if (wall > 0) hits.push({ x: pos.x, z: pos.z, impact: wall })
    this.carView.sync(this.cars, dt, this.drivenId)
    this.busView.sync(this.buses, dt)
    this.dayHour = advanceHour(this.dayHour, dt)
    this.applySky()
    const moved = dt > 0 ? Math.hypot(pos.x - this.stepX, pos.z - this.stepZ) / dt : 0
    this.stepX = pos.x
    this.stepZ = pos.z
    this.ambience.crunch(hits, pos.x, pos.z, this.walker.facing, this.trafficFile.crunch)
    this.ambience.update(dt, {
      hour: this.dayHour,
      x: pos.x,
      z: pos.z,
      yaw: this.walker.facing,
      speed: Math.min(12, moved),
      driving: this.walker.driving,
      driveSpeed: this.walker.driveSpeed,
      onFoot: !this.walker.driving && !this.walker.flying && !this.walker.riding,
      altitude: this.walker.flying ? pos.y : 0,
      muted: this.paused,
      cars: this.cars,
      buses: this.buses,
    })
    this.hud.setPlace(`${formatHour(this.dayHour)} · ${describePlace(this.layout, pos.x, pos.z)}`)
    this.hud.setNearby(this.nearbyText())
    this.delivery.update(dt, {
      x: pos.x,
      z: pos.z,
      driving: this.walker.driving,
      speed: moved,
    })
    this.minimap.draw({
      x: pos.x,
      z: pos.z,
      yaw: this.walker.facing,
      buses: this.buses,
      crowdXY: this.crowdView.xy,
      people: this.citizens,
      heli: this.helicopter.pose,
      job: this.delivery.marker,
    })
    this.wordnet.draw(dt)
    this.renderer.render(this.scene, this.camera)
  }

  private syncVehicles(): void {
    let n = 0
    for (const car of this.cars) {
      this.putDisc(this.vehicleDiscs, n++, car.x, car.z, CAR_HALF_WIDTH, `car:${car.id}`, car.yaw, CAR_HALF_LENGTH)
    }
    for (const bus of this.buses) {
      this.putDisc(this.vehicleDiscs, n++, bus.x, bus.z, BUS_HALF_WIDTH, `bus:${bus.id}`, bus.yaw, BUS_HALF_LENGTH)
    }
    this.vehicleDiscs.length = n
  }

  private syncPeople(): void {
    let n = 0
    const xy = this.crowdView.xy
    for (let i = 0; i < this.crowd.people.length; i++) {
      this.putDisc(this.personDiscs, n++, xy[i * 2]!, xy[i * 2 + 1]!, PERSON_RADIUS, crowdId(i))
    }
    for (const person of this.citizens) {
      this.putDisc(this.personDiscs, n++, person.x, person.z, PERSON_RADIUS, person.id)
    }
    for (const player of this.remotes) {
      this.putDisc(this.personDiscs, n++, player.x, player.z, PERSON_RADIUS, player.id)
    }
    this.personDiscs.length = n
  }

  private syncBlockers(): void {
    const blockers = this.blockers
    blockers.length = 0
    for (const disc of this.vehicleDiscs) blockers.push(disc)
    for (const disc of this.personDiscs) blockers.push(disc)
  }

  /** Other players never freeze you. Their figure steps aside instead. */
  private withoutRemotes(): Disc[] {
    this.remoteIds.clear()
    for (const player of this.remotes) this.remoteIds.add(player.id)
    const list = this.walkerHold
    list.length = 0
    const driving = this.walker.driving
    for (const disc of this.blockers) {
      if (disc.id && this.remoteIds.has(disc.id)) continue
      if (driving && disc.id?.startsWith('car:')) continue
      list.push(disc)
    }
    return list
  }

  private withFoot(list: readonly Disc[]): Disc[] {
    const hold = this.puppetHold
    hold.length = 0
    for (const disc of list) hold.push(disc)
    if (this.placeFoot()) hold.push(this.footDisc)
    return hold
  }

  private drivenRide(): NetCarRide | null {
    if (!this.drivenId) return null
    const car = this.cars.find((entry) => entry.id === this.drivenId)
    if (!car) return null
    return { model: car.model, color: car.color }
  }

  /** Put each remote driver in the car you can see, and hide them on foot. */
  private applyRemoteCars(): void {
    const driving = new Set<string>()
    for (const player of this.remotes) {
      if (!player.car) continue
      driving.add(player.id)
      let car = this.cars.find((entry) => entry.driver === player.id)
      if (!car) {
        let best: CarSim | null = null
        let bestDist = 12
        for (const entry of this.cars) {
          if (entry.driver || entry.id === this.drivenId) continue
          const dist = Math.hypot(entry.x - player.x, entry.z - player.z)
          if (dist >= bestDist) continue
          best = entry
          bestDist = dist
        }
        if (best) car = best
        else {
          car = {
            id: `remote:${player.id}`,
            model: player.car.model,
            color: player.car.color,
            lane: 0,
            dist: 0,
            speed: 0,
            x: player.x,
            z: player.z,
            yaw: player.yaw,
            driver: player.id,
          }
          this.cars.push(car)
        }
      }
      car.driver = player.id
      car.model = player.car.model
      car.color = player.car.color
      car.x = player.x
      car.z = player.z
      car.yaw = player.yaw
      car.speed = 0
    }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i]!
      if (!car.driver || car.driver === 'you' || driving.has(car.driver)) continue
      if (car.id.startsWith('remote:')) {
        this.cars.splice(i, 1)
        continue
      }
      car.driver = null
      parkOnLane(car, this.network)
    }
  }

  private copyDrivenCar(x: number, z: number): void {
    if (!this.drivenId) return
    const index = this.cars.findIndex((entry) => entry.id === this.drivenId)
    if (index < 0) {
      this.drivenId = null
      return
    }
    const car = this.cars[index]!
    car.x = x
    car.z = z
    car.yaw = this.walker.facing
    car.speed = this.walker.driveSpeed
    car.driver = 'you'
    const disc = this.vehicleDiscs[index]
    if (!disc) return
    disc.x = x
    disc.z = z
    disc.yaw = car.yaw
  }

  /** Screen point of the car the chase camera is following. */
  private carScreen(): { x: number; y: number } {
    const pos = this.walker.mesh.position
    const point = new THREE.Vector3(pos.x, pos.y + 1.15, pos.z)
    point.project(this.camera)
    return {
      x: (point.x * 0.5 + 0.5) * window.innerWidth,
      y: (-point.y * 0.5 + 0.5) * window.innerHeight,
    }
  }

  /** The bump moves the driven car. Keep the player on it, at the new speed. */
  private keepDrivenBump(): void {
    if (!this.drivenId) return
    const car = this.cars.find((entry) => entry.id === this.drivenId)
    if (!car) return
    const pos = this.walker.mesh.position
    const dx = car.x - pos.x
    const dz = car.z - pos.z
    if (Math.hypot(dx, dz) < 0.001 && Math.abs(car.speed - this.walker.driveSpeed) < 0.04) return
    this.walker.nudge(dx, dz, car.speed)
  }

  private crowdBlocks(): Disc[] {
    const list = this.crowdHold
    list.length = 0
    for (const disc of this.vehicleDiscs) list.push(disc)
    if (this.placeFoot()) list.push(this.footDisc)
    return list
  }

  private trafficObstacles(): Disc[] {
    const list = this.trafficHold
    list.length = 0
    if (this.placeFoot()) list.push(this.footDisc)
    for (const disc of this.personDiscs) list.push(disc)
    for (const disc of this.vehicleDiscs) {
      if (disc.id?.startsWith('bus:')) list.push(disc)
    }
    return list
  }

  private busObstacles(): Disc[] {
    const list = this.busHold
    list.length = 0
    if (this.placeFoot()) list.push(this.footDisc)
    for (const disc of this.personDiscs) list.push(disc)
    for (const disc of this.vehicleDiscs) {
      if (disc.id?.startsWith('car:')) list.push(disc)
    }
    return list
  }

  private placeFoot(): boolean {
    if (this.walker.flying || this.walker.riding || this.walker.driving) return false
    const pos = this.walker.mesh.position
    this.footDisc.x = pos.x
    this.footDisc.z = pos.z
    this.footDisc.r = PERSON_RADIUS
    this.footDisc.id = 'you'
    this.footDisc.yaw = undefined
    this.footDisc.len = undefined
    return true
  }

  private putDisc(
    list: Disc[],
    index: number,
    x: number,
    z: number,
    r: number,
    id: string,
    yaw?: number,
    len?: number,
  ): void {
    let disc = list[index]
    if (!disc) {
      disc = { x, z, r, id }
      list[index] = disc
    }
    disc.x = x
    disc.z = z
    disc.r = r
    disc.id = id
    disc.yaw = yaw
    disc.len = len
  }

  private submit(text: string): void {
    const clean = text.trim().slice(0, 240)
    if (!clean) return
    this.hud.setDraft('')
    if (!this.client.connected) {
      const waiting = this.nearest()
      if (waiting && waiting.dist <= this.peopleFile.talkRange) this.hold(waiting.id)
      this.hud.pushLine('Street', 'The city server is offline, so nobody can answer yet.')
      return
    }
    const pos = this.walker.mesh.position
    this.client.flushMove()
    const near = this.nearest()
    if (near && near.dist <= this.peopleFile.talkRange) {
      this.hold(near.id)
      const index = crowdIndex(near.id)
      const t = index === null ? undefined : this.crowdFreeze.get(index)
      this.client.send({ type: 'talk', npcId: near.id, text: clean, x: pos.x, z: pos.z, ...(t !== undefined ? { t } : {}) })
      this.hud.pushLine('You', clean)
      this.hud.setSubtitle('You', clean)
      this.wordnet.hear(clean)
      return
    }
    this.client.send({ type: 'say', text: clean, x: pos.x, z: pos.z })
    this.hud.pushLine('You', clean)
    this.wordnet.hear(clean)
  }

  private onSpeech(msg: SpeechMsg): void {
    if (msg.kind === 'player' && msg.id === this.client.id) return
    this.hud.pushLine(msg.name, msg.text)
    this.hud.setSubtitle(msg.name, msg.text)
    this.wordnet.hear(msg.text)
    if (msg.kind === 'npc') {
      if (crowdIndex(msg.id) !== null) this.crowdView.say(msg.id, msg.text)
      else this.citizensView.say(msg.id, msg.text)
    } else this.walkersView.say(msg.id, msg.text)
    if (msg.aloud && this.hear) {
      if (msg.audio) {
        void playMp3(msg.audio).then((played) => {
          if (!played) speak(msg.text, msg.voice)
        })
      } else {
        speak(msg.text, msg.voice)
      }
    }
  }

  private toggleMic(): void {
    if (this.mic) {
      this.mic.stop()
      this.mic = null
      this.hud.setMic(false)
      return
    }
    const handle = listen(
      (text) => {
        this.hud.setDraft(text)
        this.submit(text)
      },
      (text) => this.hud.setDraft(text),
      () => {
        this.mic = null
        this.hud.setMic(false)
      },
    )
    if (!handle) {
      this.hud.pushLine('Street', 'This browser has no speech recognition. Type instead.')
      return
    }
    this.mic = handle
    this.hud.setMic(true)
  }

  private releaseHeld(x: number, z: number): void {
    const reach = this.peopleFile.talkRange + 1.6
    for (const id of this.held) {
      const person = this.sim.find((entry) => entry.id === id)
      if (!person || Math.hypot(person.x - x, person.z - z) > reach) this.held.delete(id)
    }
  }

  private toggleHeli(): void {
    if (this.walker.driving || this.walker.riding) return
    if (this.walker.flying) {
      this.walker.endFly()
      this.helicopter.release()
      this.hud.setStatus(WALK_HINT)
      return
    }
    const pos = this.walker.mesh.position
    this.helicopter.aim(pos.x, pos.z)
  }

  private toggleVehicle(): void {
    if (this.walker.flying) return
    if (this.walker.driving) {
      this.parkCar()
      return
    }
    if (this.walker.riding) {
      this.leaveBus()
      return
    }
    const pos = this.walker.mesh.position
    const car = this.nearestStoppedCar(pos.x, pos.z)
    const bus = this.nearestStoppedBus(pos.x, pos.z)
    if (car && (!bus || car.dist <= bus.dist)) {
      car.car.driver = 'you'
      car.car.speed = 0
      this.drivenId = car.car.id
      this.walker.beginDrive(car.car.x, car.car.z, car.car.yaw)
      this.hud.setStatus(DRIVE_HINT)
      return
    }
    if (bus) {
      this.riddenId = bus.bus.id
      this.walker.beginRide(bus.bus.x, bus.bus.z, bus.bus.yaw)
      this.hud.setStatus(RIDE_HINT)
    }
  }

  private parkCar(): void {
    const car = this.cars.find((entry) => entry.id === this.drivenId)
    const pos = this.walker.mesh.position
    const yaw = this.walker.facing
    this.walker.endDrive()
    this.drivenId = null
    if (car) {
      car.x = pos.x
      car.z = pos.z
      car.yaw = yaw
      car.driver = null
      parkOnLane(car, this.network)
    }
    this.hud.setStatus(WALK_HINT)
  }

  private leaveBus(): void {
    this.riddenId = null
    this.walker.endRide()
    this.hud.setStatus(WALK_HINT)
  }

  private nearestStoppedCar(x: number, z: number): { car: CarSim; dist: number } | null {
    let best: { car: CarSim; dist: number } | null = null
    for (const car of this.cars) {
      if (car.driver) continue
      const dist = Math.hypot(car.x - x, car.z - z)
      if (dist > this.trafficFile.enterRange || car.speed > 1.6) continue
      if (!best || dist < best.dist) best = { car, dist }
    }
    return best
  }

  private nearestStoppedBus(x: number, z: number): { bus: BusSim; dist: number } | null {
    let best: { bus: BusSim; dist: number } | null = null
    for (const bus of this.buses) {
      const dist = Math.hypot(bus.x - x, bus.z - z)
      if (dist > 8 || bus.speed > 1.4) continue
      if (!best || dist < best.dist) best = { bus, dist }
    }
    return best
  }

  private nearbyText(): string {
    if (this.walker.flying) {
      this.hud.setPlaceholder('Flying')
      return 'Above the streets · H to land'
    }
    if (this.walker.riding) {
      this.hud.setPlaceholder('On the bus')
      return 'Riding · F to hop off'
    }
    if (this.walker.driving) {
      this.hud.setPlaceholder('Driving')
      return 'Driving · F to park'
    }
    if (this.helicopter.incoming) {
      this.hud.setPlaceholder('Helicopter inbound')
      return 'The helicopter is on its way'
    }
    const pos = this.walker.mesh.position
    const car = this.nearestStoppedCar(pos.x, pos.z)
    const bus = this.nearestStoppedBus(pos.x, pos.z)
    if (car && (!bus || car.dist <= bus.dist)) {
      this.hud.setPlaceholder('Drive')
      return 'F to drive'
    }
    if (bus) {
      this.hud.setPlaceholder('Ride the bus')
      return 'F to ride the bus'
    }
    const waiting = this.nearestApproach(pos.x, pos.z)
    if (waiting) return waiting
    const near = this.nearest()
    if (!near) {
      this.hud.setPlaceholder('Talk to the block')
      return 'Nobody on this corner yet.'
    }
    if (near.dist <= this.peopleFile.talkRange) {
      this.hud.setPlaceholder(`Talk to ${near.name}`)
      return `${near.name} is close · E to talk`
    }
    this.hud.setPlaceholder('Walk closer, or talk to the block')
    return `${near.name} is ${Math.round(near.dist)} m away`
  }

  private nearestApproach(x: number, z: number): string | null {
    let best = Infinity
    let kind: 'car' | 'bus' | null = null
    for (const car of this.cars) {
      const dist = Math.hypot(car.x - x, car.z - z)
      if (car.speed <= 1.6 || dist > 12 || dist >= best) continue
      best = dist
      kind = 'car'
    }
    for (const bus of this.buses) {
      const dist = Math.hypot(bus.x - x, bus.z - z)
      if (bus.speed <= 1.4 || dist > 14 || dist >= best) continue
      best = dist
      kind = 'bus'
    }
    if (kind === 'car') {
      this.hud.setPlaceholder('Stop the car')
      return 'Stand in front of the car, then F'
    }
    if (kind === 'bus') {
      this.hud.setPlaceholder('Stop the bus')
      return 'Step in front of the bus, then F'
    }
    return null
  }

  private nearest(): { id: string; name: string; dist: number } | null {
    const pos = this.walker.mesh.position
    let best: { id: string; name: string; dist: number } | null = null
    const consider = (id: string, name: string, x: number, z: number): void => {
      const dist = Math.hypot(x - pos.x, z - pos.z)
      if (!best || dist < best.dist) best = { id, name, dist }
    }
    for (const person of this.citizens) consider(person.id, person.name, person.x, person.z)
    const xy = this.crowdView.xy
    for (let i = 0; i < this.crowd.people.length; i++) {
      consider(crowdId(i), this.crowd.people[i]!.name, xy[i * 2] ?? 0, xy[i * 2 + 1] ?? 0)
    }
    return best
  }

  private hold(id: string): void {
    const index = crowdIndex(id)
    if (index === null) {
      this.held.add(id)
      return
    }
    if (!this.crowdFreeze.has(index)) this.crowdFreeze.set(index, this.time)
  }

  private releaseCrowd(x: number, z: number): void {
    const reach = this.peopleFile.talkRange + 1.6
    for (const [index, at] of this.crowdFreeze) {
      const pose = crowdPose(this.crowd, index, at)
      if (Math.hypot(pose.x - x, pose.z - z) > reach) this.crowdFreeze.delete(index)
    }
  }

  private meet(id: string): void {
    const person = this.citizens.find((entry) => entry.id === id)
    if (!person) return
    const spot = nearbySpot(this.layout, person.x, person.z)
    this.moveTo(spot.x, spot.z)
  }

  private moveTo(x: number, z: number): void {
    this.walker.teleport(x, z)
    const pos = this.walker.mesh.position
    this.client.sendMove(pos.x, pos.z, this.walker.facing, this.drivenRide())
    this.client.flushMove()
  }

  private toNet(person: PersonSim): NetPerson {
    const def = this.peopleFile.people.find((entry) => entry.id === person.id)
    if (!def) {
      return {
        id: person.id,
        name: person.id,
        voice: 'male',
        shirt: '#888888',
        pants: '#222222',
        skin: '#e0b090',
        hair: '#222222',
        x: person.x,
        z: person.z,
        yaw: person.yaw,
      }
    }
    return {
      id: def.id,
      name: def.name,
      voice: def.voice,
      shirt: def.shirt,
      pants: def.pants,
      skin: def.skin,
      hair: def.hair,
      x: person.x,
      z: person.z,
      yaw: person.yaw,
    }
  }

  private applySky(): void {
    const sky = skyAt(this.dayHour)
    const pos = this.walker.mesh.position
    const lift = 90
    this.sun.color.setHex(sky.keyColor)
    this.sun.intensity = sky.keyIntensity
    const cast = sky.shadow > 0.05
    if (this.sun.castShadow !== cast) this.sun.castShadow = cast
    this.sun.shadow.intensity = sky.shadow
    this.sun.position.set(pos.x + sky.key.x * lift, Math.max(24, pos.y + sky.key.y * lift), pos.z + sky.key.z * lift)
    this.sunTarget.position.set(pos.x, 0, pos.z)
    this.sunTarget.updateMatrixWorld()
    this.hemi.color.setHex(sky.hemiSky)
    this.hemi.groundColor.setHex(sky.hemiGround)
    this.hemi.intensity = sky.hemiIntensity
    this.skyColor.setHex(sky.background)
    this.fog.color.setHex(sky.fog)
    this.fog.near = sky.fogNear
    this.fog.far = sky.fogFar
    this.lamps.setNight(sky.night)
    this.lamps.follow(pos.x, pos.z)
    setSignGlow(this.signs, sky.night)
    this.carView.setNight(sky.night)
    this.carView.follow(pos.x, pos.z)
  }
}
