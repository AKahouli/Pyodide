import { AIMessageContent } from '@/components/ai-elements/ai-message-content';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { cn } from '@/lib/utils';
import { mapComponentsToContentParts } from '@/modules/conversation/utils';
import type { TaskResult } from '../types';
import { StepComponents } from './StepComponents';

function buildResultComponentsWithText(text: string, components: TaskResult['components'], taskId: string) {
  const trimmedText = text.trim();
  const remainingComponents = (components || []).filter((component) => {
    if (component.type !== 'text') return true;
    return String((component.data as { content?: string })?.content || '').trim() !== trimmedText;
  });

  return [
    {
      id: `playbook-final-text-${taskId}`,
      type: 'text',
      data: { content: text },
    },
    ...remainingComponents,
  ];
}

export function isHtmlStepResultText(text: string): boolean {
  return /^\s*(?:<!DOCTYPE|<html|<head|<body|<div|<p|<h[1-6]|<style|<script|<table|<article|<section|<header|<footer|<nav|<main|<aside|<form|<ul|<ol|<li|<figure|<figcaption|<blockquote|<details|<summary|<dialog|<template|<canvas|<svg|<math|<pre|<code)/i.test(text);
}

export function StepResultContent({ text, components = [], taskId, executionId, className }: {
  text?: string;
  components?: TaskResult['components'];
  taskId: string;
  executionId?: string;
  className?: string;
}) {
  const isHtml = Boolean(text && isHtmlStepResultText(text));
  const artifactComponents = components.filter((component) => component.type === 'artifact');
  const nonArtifactComponents = components.filter((component) => component.type !== 'artifact');
  const parts = text
    ? isHtml
      ? [{ type: 'webPreview' as const, content: text }]
      : mapComponentsToContentParts(buildResultComponentsWithText(text, nonArtifactComponents, taskId) as never)
    : [];
  const supplementalComponents = text && !isHtml ? artifactComponents : components;

  return (
    <div
      data-testid="step-result-markdown"
      className={cn(isHtml ? '' : 'text-[14px] [&_*]:text-[14px] [&_*]:!text-[14px]', className)}
    >
      {parts.length > 0 && (
        <MessageProvider fileViewerDisplayMode="floating">
          <AIMessageContent parts={parts} />
        </MessageProvider>
      )}
      {supplementalComponents.length > 0 && (
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <StepComponents components={supplementalComponents} taskId={taskId} executionId={executionId} />
        </div>
      )}
    </div>
  );
}
