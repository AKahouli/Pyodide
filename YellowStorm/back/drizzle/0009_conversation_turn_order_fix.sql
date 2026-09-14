UPDATE "conversation"."messages" AS "answer"
SET "created_at" = "question"."created_at" + INTERVAL '1 millisecond'
FROM "conversation"."messages" AS "question"
WHERE "answer"."conversation_type" = 'ai'
  AND "answer"."question_message_id" = "question"."id"
  AND "answer"."created_at" = "question"."created_at";
