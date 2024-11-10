"use client";

import React, { useCallback, useState, useRef } from "react";
import {
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  Controls,
  Connection,
  ReactFlowProvider,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
  ReactFlow,
} from "@xyflow/react";
import { XIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import gfm from "remark-gfm";
import { BorderBeam } from "@stianlarsen/border-beam";
import { Menu } from "@/components/menu";
import { GroupNode } from "@/components/group-node";
import { ServiceNode } from "@/components/service-node";
import { AnimatedSvgEdge } from "@/components/animated-svg-edge";
import { ConfigPanel } from "@/components/config-panel";
import { nanoid } from "nanoid";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProvider } from "@/context/provider-context";

const defaultEdges = [
  {
    id: "1->2",
    source: "1",
    target: "2",
    type: "animatedSvgEdge",
    data: {
      duration: 2,
      shape: "package",
      path: "smoothstep",
    },
  } satisfies AnimatedSvgEdge,
];

const edgeTypes = {
  animatedSvgEdge: AnimatedSvgEdge,
};

const nodeTypes = {
  GroupNode: GroupNode,
  ServiceNode: ServiceNode,
};

const Home: React.FC = () => {
  // const reactFlowWrapper = useRef<HTMLDivElement | null>(null);
  const { provider, setProvider } = useProvider();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [infoOpen, setInfoOpen] = useState<boolean>(false);

  const { screenToFlowPosition } = useReactFlow();

  const onConnect = useCallback((params: Connection) => setEdges((eds) => addEdge({ ...params, type: "animatedSvgEdge", animated: true }, eds)), []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const name = event.dataTransfer.getData("name");
      const info = event.dataTransfer.getData("info");
      const children: any = JSON.parse(event.dataTransfer.getData("children"));

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const id = nanoid();
      const newNode = {
        id,
        type: "GroupNode",
        position,
        data: {
          name,
          info,
          toggleInfoPanel,
          setNodes,
          setEdges,
          children
        },
      };

      setNodes((nds) => nds.concat(newNode));
      selectNode(event, newNode);
    },
    [screenToFlowPosition]
  );

  const toggleInfoPanel = (id: string) => {
    if (selectedNode?.id === id) {
      setInfoOpen(!infoOpen);
    } else {
      setInfoOpen(true);
    }
  };

  const selectNode = (e: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  };

  const deleteNode = () => {
    if (selectedNode) {
      setNodes((nds) => nds.filter((node) => node.id !== selectedNode.id && node.parentId !== selectedNode.id));
      setEdges((eds) => eds.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id));
      // setSelectedNode(null);
    }
  };

  const clearNode = () => {
    setNodes([]);
    setEdges([]);
    setSelectedNode(null);
  };

  return (
    <div className="flex h-full flex-grow">
      <Menu selectedProvider={provider} setSelectedProvider={setProvider} deleteNode={deleteNode} clearNode={clearNode} />
      <div className="h-full flex-grow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          edgeTypes={edgeTypes}
          defaultEdges={defaultEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={selectNode}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          fitView
          elementsSelectable
        >
          <Background />
        </ReactFlow>
      </div>
      <div className="fixed top-0 right-0 m-4">
        <ConfigPanel terraformConfig="" />
        {/* InfoPanel - Too lazy to make a separate component :v */}
        <Card className={`bg-card/10 backdrop-filter backdrop-blur-sm relative mt-2 w-[350px] transition-transform duration-300 ${infoOpen ? 'translate-x-0' : 'translate-x-[200%]'}`}>
          <CardHeader>
            <CardTitle className="text-xl">{String(selectedNode?.data.name)}</CardTitle>
            <XIcon className="absolute top-4 right-4 h-4 w-4 cursor-pointer" onClick={() => setInfoOpen(false)} />
          </CardHeader>
          <CardContent>
            <ReactMarkdown className="prose text-white" remarkPlugins={[gfm]} children={String(selectedNode?.data.info)} />
          </CardContent>
          <BorderBeam size={300} duration={5} colorFrom="#0ea5e9" colorTo="#bae6fd" />
        </Card>
      </div>
    </div>
  );
};

export default Home;