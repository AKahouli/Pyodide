import json
from src.logger.logging import get_logger
from src.smart_rag.agents.factories.delegation_factory_helper import _extract_original_expected_output
logger = get_logger("api.smart_rag.DelegationTools")

class DelegationTools:

    def __init__(self,streaming_formatter,user_request, agent_factory,mcp_helper,agent_runner,session_helper,documents_tree,brain_tree,q,citation_manager):
        self.agent_factory = agent_factory
        self.mcp_helper = mcp_helper
        self.streaming_formatter = streaming_formatter
        self.agent_runner=agent_runner
        self.user_request = user_request
        self.session_helper=session_helper
        self.documents_tree=documents_tree
        self.brain_tree=brain_tree
        self.q=q
        self.citation_manager=citation_manager

    def get_agents(self,visualisation_agent_prompt,operator_agent_prompt,report_writer_prompt,search_agent_prompt):
        try:
            # Create agents
            html_agent = self.agent_factory.create_html_agent(visualisation_agent_prompt, self.user_request.chatbot_name)
            operator_agent = self.agent_factory.create_operator_agent(
                prompt=operator_agent_prompt,
                chatbot_name=self.user_request.chatbot_name,
                user_id=self.user_request.user_id,
                brain_ids=self.user_request.brain_ids,
                session_id=self.user_request.session_id,
                brain_documents=self.user_request.brain_documents
            )
            report_writer_agent = self.agent_factory.create_report_writer_agent(
                report_writer_prompt, self.user_request.chatbot_name
            )

        except Exception as e:
            logger.error(f"Error creating agents for user {self.user_request.user_id}: {str(e)}")
            return

        async def delegate_to_search_agent(task_description: str, expected_output: str):
            """Delegate task to search agent with detailed execution tracing.

            This function is optimized for parallel execution - call multiple times for different search tasks.

            Args:
                task_description: The search task to execute
                expected_output: Expected output format

            Returns:
                Search results from the agent
            """
            # Extract original expected output from task description
            cleaned_task_description, original_expected_output = _extract_original_expected_output(task_description)

            # Use original_expected_output if found, otherwise use the provided expected_output
            final_expected_output = original_expected_output if original_expected_output else expected_output

            search_web = "standard" if self.user_request.search_web else "off"

            try:
                # Yield control to allow parallel execution
                #await asyncio.sleep(0)

                task_search_order = expected_output
                search_agent, toolkit, prompt = self.agent_factory.create_search_agent(
                    self.documents_tree, self.brain_tree, self.user_request.brain_ids, self.user_request.vectorstore_name,
                    search_web=search_web, prompt=search_agent_prompt,
                    task_order=task_search_order, chatbot_name=self.user_request.chatbot_name, top_k=self.user_request.top_k,citation_manager=self.citation_manager
                )
            except Exception as e:
                logger.error(f"Error creating search agent: {str(e)}")
                return None

            try:
                # Get agent configuration to pass to runner
                result, mcp_used, execution_summary, _ = await self.agent_runner.run_agent_tool(
                    agent=search_agent, message=cleaned_task_description,
                    session_helper=self.session_helper, user_id=self.user_request.user_id,
                    toolkit=toolkit, q=self.q, task_order=task_search_order,
                    agent_id="SearchAgent", expected_output=final_expected_output
                )

                return result

            except Exception as e:
                logger.error(f"Error in SearchAgent execution: {str(e)}")
                return None

        async def delegate_to_operator_agent(task_description: str, expected_output: str):
            """Delegate task to operator agent with detailed execution tracing.

            This function is optimized for parallel execution - call multiple times for different computational tasks.

            Args:
                task_description: The operation task to execute
                expected_output: Expected output format

            Returns:
                Operation results from the agent
            """
            # Extract original expected output from task description
            cleaned_task_description, original_expected_output = _extract_original_expected_output(task_description)

            # Use original_expected_output if found, otherwise use the provided expected_output
            final_expected_output = original_expected_output if original_expected_output else expected_output

            # Yield control to allow parallel execution
            #await asyncio.sleep(0)

            try:
                result, mcp_used, execution_summary, generated_files = await self.agent_runner.run_agent_tool(
                    agent=operator_agent, message=cleaned_task_description,
                    session_helper=self.session_helper, user_id=self.user_request.user_id, q=self.q, expected_output=final_expected_output
                )

                # Handle python_interpreter generated files if python_interpreter was used
                if mcp_used and 'python_interpreter' in mcp_used:
                    try:
                        if generated_files:
                            files_count = len(generated_files)
                            logger.info(f"python_interpreter used by OperatorAgent: {files_count} files generated - session_id: {self.user_request.session_id}")
                            logger.info(f"[MANUAL MODE - DELEGATION TOOLS] Sending {files_count} python_interpreter files to backend - agent_name: OperatorAgent, session_id: {self.user_request.session_id}")

                            for file in generated_files:
                                if self.q:
                                    upload_output = self.streaming_formatter.format_streaming_event(
                                        agent_name="OperatorAgent",
                                        agent_type="agent",
                                        chunk=json.dumps(file),
                                        message_id=self.user_request.session_id,
                                        content_type="File"
                                    )
                                    await self.q.put(upload_output)
                    except Exception as upload_error:
                        logger.exception(f"python_interpreter file retrieval failed for OperatorAgent: {str(upload_error)}")

                return result

            except Exception as e:
                logger.error(f"Error in OperatorAgent execution: {str(e)}")
                return None

        async def delegate_to_report_writer_agent(task_description: str, expected_output: str):
            """Delegate task to report writer agent with detailed execution tracing."""
            # Extract original expected output from task description
            cleaned_task_description, original_expected_output = _extract_original_expected_output(task_description)

            # Use original_expected_output if found, otherwise use the provided expected_output
            final_expected_output = original_expected_output if original_expected_output else expected_output

            try:
                result, _, execution_summary, _ = await self.agent_runner.run_agent_tool(
                    agent=report_writer_agent, message=cleaned_task_description,
                    session_helper=self.session_helper, user_id=self.user_request.user_id, q=self.q, expected_output=final_expected_output
                )

                return result
            except Exception as e:
                logger.error(f"Error in ReportWriterAgent execution: {str(e)}")
                return None

        async def delegate_to_html_agent(task_description: str, expected_output: str):
            """Delegate task to html agent with detailed execution tracing."""
            # Extract original expected output from task description
            cleaned_task_description, original_expected_output = _extract_original_expected_output(task_description)

            # Use original_expected_output if found, otherwise use the provided expected_output
            final_expected_output = original_expected_output if original_expected_output else expected_output

            try:
                result, _, execution_summary, _ = await self.agent_runner.run_agent_tool(
                    agent=html_agent, message=cleaned_task_description,
                    session_helper=self.session_helper, user_id=self.user_request.user_id, q=self.q, expected_output=final_expected_output
                )

                return result

            except Exception as e:
                logger.error(f"Error in HtmlAgent execution: {str(e)}")
                return None



        return delegate_to_report_writer_agent,delegate_to_operator_agent,delegate_to_search_agent,delegate_to_html_agent




