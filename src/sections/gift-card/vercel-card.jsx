// Core 3D engine utilities
import * as THREE from 'three'
// React hooks used in component
import { useEffect, useRef, useState } from 'react'
// React Three Fiber primitives: Canvas renders the scene, useFrame hooks into RAF, useThree gives renderer state
import { Canvas, extend, useThree, useFrame } from '@react-three/fiber'
// Drei helpers: GLTF loading, textures, prebuilt environment/lighting helpers
import { useGLTF, useTexture, Environment, Lightformer } from '@react-three/drei'
// Rapier physics primitives and joints (RigidBody, colliders, rope/spherical joints)
import { BallCollider, CuboidCollider, Physics, RigidBody, useRopeJoint, useSphericalJoint } from '@react-three/rapier'
// MeshLine is a small utility to draw a textured line (used here for the band)
import { MeshLineGeometry, MeshLineMaterial } from 'meshline'
// Leva GUI for live tweaking (debug toggle)
 
// Register custom meshline geometry/material so they can be used as JSX elements
extend({ MeshLineGeometry, MeshLineMaterial })

// Preload remote assets to avoid flicker when component mounts
useGLTF.preload('/media/objects/card.glb')
useTexture.preload('/media/images/logo.jpg')

export function Gift3dCard() {
   return (
    <Canvas camera={{ position: [0, 0, 13], fov: 25 }}>
      <ambientLight intensity={Math.PI} />
      <Physics  interpolate gravity={[0, -40, 0]} timeStep={1 / 60}>
        <Band />
      </Physics>
      <Environment background blur={0.75}>
        <color attach="background" args={['black']} />
        <Lightformer intensity={2} color="white" position={[0, -1, 5]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
        <Lightformer intensity={3} color="white" position={[-1, -1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
        <Lightformer intensity={3} color="white" position={[1, 1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
        <Lightformer intensity={10} color="white" position={[-10, 0, 14]} rotation={[0, Math.PI / 2, Math.PI / 3]} scale={[100, 10, 1]} />
      </Environment>
    </Canvas>
  )
}

/*
  Gift3dCard is a self-contained 3D scene mounted in a <Canvas>.
  - Canvas: R3F root with a camera
  - Physics: Rapier physics world; `debug` toggles collider visualization
  - Band: the visual + physics objects (defined below)
  - Environment + Lightformer: HDR-like lighting helpers from Drei
*/

function Band({ maxSpeed = 50, minSpeed = 10 }) {
  // Refs to various physics bodies and the band mesh
  const band = useRef(), fixed = useRef(), j1 = useRef(), j2 = useRef(), j3 = useRef(), card = useRef()

  // Temp vectors reused every frame to avoid allocations
  const vec = new THREE.Vector3(), ang = new THREE.Vector3(), rot = new THREE.Vector3(), dir = new THREE.Vector3()

  // Common props for each physics segment - dynamic bodies that can sleep and use damping
  const segmentProps = { type: 'dynamic', canSleep: true, colliders: false, angularDamping: 2, linearDamping: 2 }

  // Load the GLTF model (card + clamp meshes) and the band texture
  const { nodes, materials } = useGLTF('/media/objects/card.glb')
  const texture = useTexture('/media/images/logo.jpg')
  // const texture = useTexture('https://assets.vercel.com/image/upload/contentful/image/e5382hct74si/SOT1hmCesOHxEYxL7vkoZ/c57b29c85912047c414311723320c16b/band.jpg')

  // Renderer size used to set the meshLine resolution
  const { width, height } = useThree((state) => state.size)

  // Catmull-Rom curve defines the smooth band shape; we initialise with 4 points
  const [curve] = useState(() => new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]))

  // Interaction state: whether the card is being dragged or hovered
  const [dragged, drag] = useState(false)
  const [hovered, hover] = useState(false)

  // Create rope joints between the fixed point and j1, j1-j2, j2-j3 to simulate a flexible band
  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], 1])
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], 1])
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], 1])
  // Attach the end of the rope to the card with a spherical joint so it can swivel
  useSphericalJoint(j3, card, [[0, 0, 0], [0, 1.45, 0]])

  useEffect(() => {
    if (hovered) {
      document.body.style.cursor = dragged ? 'grabbing' : 'grab'
      return () => void (document.body.style.cursor = 'auto')
    }
  }, [hovered, dragged])

  // useFrame runs on every RAF; we use it to update physics-driven visuals and kinematic dragging
  useFrame((state, delta) => {
    // If the user is dragging the card, convert pointer coords to world space and move the kinematic body
    if (dragged) {
      // project pointer into world
      vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera)
      dir.copy(vec).sub(state.camera.position).normalize()
      vec.add(dir.multiplyScalar(state.camera.position.length()))

      // wake up physics bodies so they react immediately
      ;[card, j1, j2, j3, fixed].forEach((ref) => ref.current?.wakeUp())

      // setNextKinematicTranslation moves the kinematic rigid body to follow the pointer
      card.current?.setNextKinematicTranslation({ x: vec.x - dragged.x, y: vec.y - dragged.y, z: vec.z - dragged.z })
    }

    // If the fixed anchor exists, update the band curve and smooth joint positions to reduce jitter
    if (fixed.current) {
      // Smooth the intermediate joint positions (lerped) to stabilize movement when pulled hard
      ;[j1, j2].forEach((ref) => {
        if (!ref.current.lerped) ref.current.lerped = new THREE.Vector3().copy(ref.current.translation())
        const clampedDistance = Math.max(0.1, Math.min(1, ref.current.lerped.distanceTo(ref.current.translation())))
        ref.current.lerped.lerp(ref.current.translation(), delta * (minSpeed + clampedDistance * (maxSpeed - minSpeed)))
      })

      // Recompute the Catmull-Rom curve control points from joint positions
      curve.points[0].copy(j3.current.translation())
      curve.points[1].copy(j2.current.lerped)
      curve.points[2].copy(j1.current.lerped)
      curve.points[3].copy(fixed.current.translation())

      // Update the mesh line geometry with points sampled from the curve
      band.current.geometry.setPoints(curve.getPoints(32))

      // Slightly adjust card angular velocity to make it tilt back toward the screen (visual polish)
      ang.copy(card.current.angvel())
      rot.copy(card.current.rotation())
      card.current.setAngvel({ x: ang.x, y: ang.y - rot.y * 0.25, z: ang.z })
    }
  })

  // Use chordal parameterization for smoother band interpolation
  curve.curveType = 'chordal'
  // Repeat the band texture along the line
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping

  return (
    <>
      {/* group: anchor point offset for the whole band/card assembly */}
      <group position={[-2, 4, 0]}>
        {/* fixed anchor: the start of the rope (does not move) */}
        <RigidBody ref={fixed} {...segmentProps} type="fixed" />

        {/* intermediate rope nodes. These are small dynamic bodies connected by rope joints above */}
        <RigidBody position={[0.5, 0, 0]} ref={j1} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[1, 0, 0]} ref={j2} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[1.5, 0, 0]} ref={j3} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>

        {/* The card: a slightly larger rigid body with a cuboid collider. When dragging, it becomes kinematic so we move it directly */}
        <RigidBody position={[2, 0, 0]} ref={card} {...segmentProps} type={dragged ? 'kinematicPosition' : 'dynamic'}>
          <CuboidCollider args={[0.5, 1.125, 0.01]} />

          {/* This group contains the visual meshes for the card and registers pointer events for dragging */}
          <group
            scale={2.25}
            position={[0, -1.2, -0.05]}
            onPointerOver={() => hover(true)}
            onPointerOut={() => hover(false)}
            onPointerUp={(e) => (e.target.releasePointerCapture(e.pointerId), drag(false))}
            onPointerDown={(e) => (e.target.setPointerCapture(e.pointerId), drag(new THREE.Vector3().copy(e.point).sub(vec.copy(card.current.translation()))))}>

            {/* Main card mesh loaded from the GLTF. Materials are tuned for a slightly shiny finish */}
            <mesh geometry={nodes.card.geometry}>
              <meshPhysicalMaterial map={materials.base.map} map-anisotropy={16} clearcoat={1} clearcoatRoughness={0.1} roughness={0.3} metalness={0.2} />
            </mesh>

            {/* additional parts of the model (clip, clamp) reused from the GLTF */}
            <mesh geometry={nodes.clip.geometry} material={materials.metal} material-roughness={0.21} />
            <mesh geometry={nodes.clamp.geometry} material={materials.metal} />
          </group>
        </RigidBody>
      </group>

      {/* The visual band rendered as a textured mesh line. meshLineGeometry/material are custom elements registered above */}
      <mesh ref={band}>
        <meshLineGeometry />
        <meshLineMaterial color="white" depthTest={false} resolution={[width, height]} useMap
          map={texture}
          repeat={[-3, 1]} lineWidth={1} />
      </mesh>
    </>
  )
}