# Frontend Changelog

All notable changes to the YelloStorm frontend.

## [0.1.3](https://github.com/YellowsysOrg/YellowStorm/compare/front-v0.1.2...front-v0.1.3) (2026-02-12)


### Features

* **agent-type:** added agent type slug [#148](https://github.com/YellowsysOrg/YellowStorm/issues/148) ([6abda44](https://github.com/YellowsysOrg/YellowStorm/commit/6abda442253510d70175003ed0733afadb54f021))
* **agent:** added ability to tag agents in a conversation [#164](https://github.com/YellowsysOrg/YellowStorm/issues/164) ([5210289](https://github.com/YellowsysOrg/YellowStorm/commit/52102892e5193562815f06fdb5486984e5d6980a))
* **agent:** added the agents management REST api [#148](https://github.com/YellowsysOrg/YellowStorm/issues/148) ([b63cf4b](https://github.com/YellowsysOrg/YellowStorm/commit/b63cf4b88ab87c5ec7ed271438d357cbea456873))
* **agent:** added undefined to model ([c77a629](https://github.com/YellowsysOrg/YellowStorm/commit/c77a629aa473423e446835a6814d1e5d8793c4b6))
* **agent:** each agent can now have seleced tools and workspaces [#148](https://github.com/YellowsysOrg/YellowStorm/issues/148) ([4e74486](https://github.com/YellowsysOrg/YellowStorm/commit/4e74486ac8ac3e1e76a5b2216829fb152e7c82bb))
* **agent:** each agent type now has a prompt per model [#148](https://github.com/YellowsysOrg/YellowStorm/issues/148) ([8efc653](https://github.com/YellowsysOrg/YellowStorm/commit/8efc65379779dbe81e779f2f97b916ef1529fbd8))
* **agent:** fixed copy paste not detecting pasted agents ([1b84a78](https://github.com/YellowsysOrg/YellowStorm/commit/1b84a782bbacb14e0d00c41a64e27c5f8ac64397))
* **agents:** added a scroll to required field when a required field is set [#148](https://github.com/YellowsysOrg/YellowStorm/issues/148) ([a1c0eaa](https://github.com/YellowsysOrg/YellowStorm/commit/a1c0eaa481bed890fc79a15ac883169774fa402e))
* **agent:** updated admin agent type page and fixed issue with sending agents from new conversation page [#164](https://github.com/YellowsysOrg/YellowStorm/issues/164) ([d5bce69](https://github.com/YellowsysOrg/YellowStorm/commit/d5bce69403afdffda22dee58f5a99e587f0ad782))
* **maintenance:** added role to skip maintenance for admins ([5b11686](https://github.com/YellowsysOrg/YellowStorm/commit/5b116867480e0c9a7f98066d3b53774930dedba0))
* **models:** removed old fields, and added new field in the api response ([babcce8](https://github.com/YellowsysOrg/YellowStorm/commit/babcce8f3518f9270ca55914195b1f11d6e64c5f))
* **tools:** Added Tool management (CRUD)  [#159](https://github.com/YellowsysOrg/YellowStorm/issues/159) ([620a2b4](https://github.com/YellowsysOrg/YellowStorm/commit/620a2b436db35c50d07ba2908867b05294db3d34))


### Bug Fixes

* **workspace:** fixed workspace sidebar pagination ([b2f095b](https://github.com/YellowsysOrg/YellowStorm/commit/b2f095b38e89fabcf6bcffe5929da333a4f4382c))

## [0.1.2](https://github.com/YellowsysOrg/YellowStorm/compare/front-v0.1.1...front-v0.1.2) (2026-02-06)


### Features

* added support for pptx ([3bf577c](https://github.com/YellowsysOrg/YellowStorm/commit/3bf577ccf56918d590b3b7c8cb46defaa74fb81b))
* **conversation:** added workspace sheet in conversation to see and select workspaces in a conversation ([f065a0c](https://github.com/YellowsysOrg/YellowStorm/commit/f065a0c45b51482db60d321304669c6e7e18bd4c))
* **file-viewer:** added new module File-viewer, it allows user to view content of files, supported file types: PDF, image files, any text file type ([9f04ede](https://github.com/YellowsysOrg/YellowStorm/commit/9f04ede7dc6f8269d9eb1b300e3a32efaec7a640))
* **file-viewer:** you can now open fileviewer from sources ([4e7cb94](https://github.com/YellowsysOrg/YellowStorm/commit/4e7cb944342244757d54b4e6655f73acf6d8e4f7))
* **inline-citation:** added clamping on the citation page content ([2d7a29e](https://github.com/YellowsysOrg/YellowStorm/commit/2d7a29ee75563a1335dd7196d6f090fce0b2a524))
* **sidebar:** updated shadcn sidebar to react 19 (adapted to react 18) ([97ef688](https://github.com/YellowsysOrg/YellowStorm/commit/97ef688c44992b856114844f682f9121bc00b1f5))
* **sources:** artifacts can now be viewed using file viewer ([264aa01](https://github.com/YellowsysOrg/YellowStorm/commit/264aa0181d8d19bd996fbdd670adc3b3636c7bf6))
* **style:** added animation packages ([8469ff9](https://github.com/YellowsysOrg/YellowStorm/commit/8469ff941c4729f085773ae92019b32446abb4b4))
* **theme:** added color palette options ([979b11e](https://github.com/YellowsysOrg/YellowStorm/commit/979b11e7e4a4b6d32dc9d0458422f467bc5f2a89))
* **workspace:** add real-time document indexing status updates ([0204887](https://github.com/YellowsysOrg/YellowStorm/commit/0204887e69059bed85eea51dd05a8cc9152581c5))


### Bug Fixes

* **conversation_share:** fixed share button in sidebar not opening share modal instead returning a toast with share coming soon ([bd47ffa](https://github.com/YellowsysOrg/YellowStorm/commit/bd47ffabb7af4560eb2c3e2560763cc5fdf133a6))
* **inline-citation:** changed brainId to workspaceId ([045084c](https://github.com/YellowsysOrg/YellowStorm/commit/045084c32ce58f762cf8a278a7f5e241370c7726))
* **layout:** adjusted position of the profile menu context ([99bd261](https://github.com/YellowsysOrg/YellowStorm/commit/99bd261b05a3635f67beb01d981c6471d7c5b477))
* **layout:** fixed the layout reactivity and general UX(animations width, responsiveness) ([14c82a4](https://github.com/YellowsysOrg/YellowStorm/commit/14c82a4dc830207f0bbb7cecf75e98e9f2a771b0))
* **login:** Improved Login form flow ([be6eb46](https://github.com/YellowsysOrg/YellowStorm/commit/be6eb4641a4306d4339ad68ed8eb9670961a63bc))
* **notifications:** improved the way eviction is handled to avoid infinite loop of reconnections ([a2cb5c0](https://github.com/YellowsysOrg/YellowStorm/commit/a2cb5c00c194cffdc492ba7d2d1f3602882a6b4b))
* **notifications:** Removeduser from the dependency array and replace it with a stable derived value to stop the unnecessary teardown/reconnect cycle ([f80617d](https://github.com/YellowsysOrg/YellowStorm/commit/f80617d263d65ae34201b9662ccc4cd91da164f3))
* **sidebar:** removed box shadow of the sidebar buttons ([3daea46](https://github.com/YellowsysOrg/YellowStorm/commit/3daea4614c5b15e3f7603bf2cc97aae71e4a52c5))
* **theme:** fixed neighbor theme sidebar active buttons accent ([c240f8a](https://github.com/YellowsysOrg/YellowStorm/commit/c240f8adb8d1fd6224c9b219e8b0a10f1d107447))
* **workspace:** fixed a bug in the workspace reindex function wiping document data from store after successfull reindex request ([fc9e84e](https://github.com/YellowsysOrg/YellowStorm/commit/fc9e84e553a1f16e21d0950d104ab0195660ee4e))
* **workspace:** fixed a bug in workspace manager sheet, no loading documents in selected workspace ([afc1da5](https://github.com/YellowsysOrg/YellowStorm/commit/afc1da5dade41c0687f9315b5e7e422127d4cd64))


### Performance

* fixed packages vulnerabilities ([22aa882](https://github.com/YellowsysOrg/YellowStorm/commit/22aa882730247e790ad7599feb0aa23d304035c6))
* **theme:** updated shadcn theme to latest version ([345fe82](https://github.com/YellowsysOrg/YellowStorm/commit/345fe82e4b875f5defbcdb538c31ad58b5089f71))


### Refactoring

* improved workspace responsiveness ([f2df7da](https://github.com/YellowsysOrg/YellowStorm/commit/f2df7da3445e4f45223c5379406ab986aaa9e3ec))

## [0.1.1](https://github.com/YellowsysOrg/YellowStorm/compare/front-v0.1.0...front-v0.1.1) (2026-02-03)


### Performance

* fixed ts errors for build ([a574dc8](https://github.com/YellowsysOrg/YellowStorm/commit/a574dc844e1fc752dedde771346800e6ab59c03d))

## 0.1.0 (2026-02-02)


### Features

* add 'sources' type to MessageComponent and update related schema and utility functions ([eb2d7f6](https://github.com/YellowsysOrg/YellowStorm/commit/eb2d7f637b099714cd36a7902a951e3c5f488899))
* add agent_mode property to StreamRequest for manual agent configuration ([115e266](https://github.com/YellowsysOrg/YellowStorm/commit/115e266bb681ebf16e23e1697402edf024116f85))
* add Bot icon rendering in PlanPartRenderer for agent display ([f4bb3f5](https://github.com/YellowsysOrg/YellowStorm/commit/f4bb3f5024e3266ac682e925da03895297bd156a))
* add conversation ID check for stream events in conversation store ([1310cf5](https://github.com/YellowsysOrg/YellowStorm/commit/1310cf5a78ac6f09d5b0e4ba19375e4fe04d593f))
* add delete conversation functionality with confirmation dialog ([e440ebd](https://github.com/YellowsysOrg/YellowStorm/commit/e440ebd857bd7331d8d91dafafffbec3e8eab726))
* add download functionality for code and web preview components ([a09d5c8](https://github.com/YellowsysOrg/YellowStorm/commit/a09d5c8687c968c914697274511a57c11e0a880d))
* add error handling components and update message types across the application ([647a026](https://github.com/YellowsysOrg/YellowStorm/commit/647a026e8d54b2f1b48575e4eeb2307871de7b09))
* add isStreaming prop to AIMessageContent and ChatMessageBubble for better streaming handling ([6d651dd](https://github.com/YellowsysOrg/YellowStorm/commit/6d651ddc56898a6fa0a0712df99516ba80944bbf))
* add known issues documentation for workspace modal and layout problems ([fed0f3e](https://github.com/YellowsysOrg/YellowStorm/commit/fed0f3e8a739ba4ce421582c7ff5aeffc6d868e6))
* add logging for incoming gRPC data chunks in StreamService ([4e3e356](https://github.com/YellowsysOrg/YellowStorm/commit/4e3e356833313d4a06244076d4fe78db6588001c))
* add support for web preview component in markdown conversion ([a948bec](https://github.com/YellowsysOrg/YellowStorm/commit/a948bec968a37c0b79ff3cea30c8c176d1af7ea5))
* add task component support in message schema and related utilities ([781b55a](https://github.com/YellowsysOrg/YellowStorm/commit/781b55a7ad21ddadebbb378ba3b09cb92e7abde0))
* add usage tracking guards to sendMessage and regenerate methods ([e43646a](https://github.com/YellowsysOrg/YellowStorm/commit/e43646a4ccfc28fc6e0b3143d2353da7a05d2d1a))
* better sidebar, and sidebar behaivour ([8d814e9](https://github.com/YellowsysOrg/YellowStorm/commit/8d814e95d9c374fb020e6fdb10f53fcf86bd79d5))
* enhance component handling in StreamService and update proto definitions for new component types ([986f697](https://github.com/YellowsysOrg/YellowStorm/commit/986f697cc6203c432125860007006cc0f0b65f38))
* enhance content merging for 'code' type in StreamService and store ([d1d39d4](https://github.com/YellowsysOrg/YellowStorm/commit/d1d39d46d782dfc6ab0c0cf3f694f421363bc545))
* enhance message loading with scroll position preservation and loading indicators ([3ef640b](https://github.com/YellowsysOrg/YellowStorm/commit/3ef640b2066f23248c49045cfff5298f09a8b7fb))
* enhance plan and usage tracking in conversation module with updated structures and rendering ([a81070d](https://github.com/YellowsysOrg/YellowStorm/commit/a81070d3d2d5975e04d808bde5b9c9212af083c1))
* enhance StarsBackground component with improved star management and shooting star effects ([9bdfe58](https://github.com/YellowsysOrg/YellowStorm/commit/9bdfe58d183f01c03f70f230365169888e0e1f61))
* implement conversation name generation and typewriter effect for display ([b192589](https://github.com/YellowsysOrg/YellowStorm/commit/b1925898b9345debc68305cb209b97d3cd103dd1))
* implement frontend buffering for throttled delivery of stream chunks ([c93896d](https://github.com/YellowsysOrg/YellowStorm/commit/c93896df08712789e4ac6bc9cc986fb4afe919cf))
* implement streaming buffer for batched updates to enhance performance ([85705b2](https://github.com/YellowsysOrg/YellowStorm/commit/85705b297c86199282ba27eaf62035cb3e0fa02c))
* implement streaming components for queue, plan, and checkpoint with proper data handling ([60f8b20](https://github.com/YellowsysOrg/YellowStorm/commit/60f8b20e3cc534b34116ee4fb6e9d34049c78b74))
* implement timestamp formatting for chat messages ([f102dbc](https://github.com/YellowsysOrg/YellowStorm/commit/f102dbc1a80c0011ff4164fc6209b50ed082a21d))
* implement web preview component and context for message handling ([4040229](https://github.com/YellowsysOrg/YellowStorm/commit/4040229376700c7aa196317949bbec62e0df60fd))
* improve layout and responsiveness across conversation and sidebar components ([16b2c7e](https://github.com/YellowsysOrg/YellowStorm/commit/16b2c7e4f50fd7a28df622cd1dd568c84511f5ed))
* improve layout and spacing in ChatConversationContent and ChatMessageBubble components ([7aecf7d](https://github.com/YellowsysOrg/YellowStorm/commit/7aecf7db479cae2dc166cf70ac752bd73cf0fbdf))
* integrate usage tracking in conversation module and update related services ([926cbfd](https://github.com/YellowsysOrg/YellowStorm/commit/926cbfd06cb77b6ca7f5a72a43a227909b743b3c))
* refactor AppSidebar to use history panel state and remove unused state ([4d7d832](https://github.com/YellowsysOrg/YellowStorm/commit/4d7d832c0c35a1620c92b817e7ea0b923a51db2a))
* refine outputAvailable logic in conversation data handling ([9aff81c](https://github.com/YellowsysOrg/YellowStorm/commit/9aff81ca92a59d0c4e7fa0ef825dde710600cfc2))


### Bug Fixes

* added messages loading state to conversation components ([0f697c9](https://github.com/YellowsysOrg/YellowStorm/commit/0f697c902b00c6044d1dd1e527f1a4417620c19a))
* added workspace_context ([3f7ef11](https://github.com/YellowsysOrg/YellowStorm/commit/3f7ef11a67f1c0994deeb803e4d6e7cac4029baf))
* adjust styling for Plan and Task components to improve layout ([d278ab3](https://github.com/YellowsysOrg/YellowStorm/commit/d278ab3f391520a2ee2224fc1d8d8b1163e2df5b))
* changed timestamp position for user's message ([d49591d](https://github.com/YellowsysOrg/YellowStorm/commit/d49591dca182236321363a95864196b5b0e273f7))
* correct syntax errors in Usage and StreamChunk messages ([81f4eb1](https://github.com/YellowsysOrg/YellowStorm/commit/81f4eb1c6b67f176ef66752da81f97dc31ef4fd5))
* disabled folders button ([6eb9c9e](https://github.com/YellowsysOrg/YellowStorm/commit/6eb9c9e470dfb6f812c08d488ec3c30e1947e831))
* enhance layout for PlanPartRenderer and ChatMessageBubble components for better alignment ([433ad76](https://github.com/YellowsysOrg/YellowStorm/commit/433ad763c94ee9b085cf96ad328af1cbee66a1a0))
* fixed appsidebar zindex ([3b672d2](https://github.com/YellowsysOrg/YellowStorm/commit/3b672d23ac4f7107287cf4aa7be14ce235c5e27e))
* fixed backend ([70a575e](https://github.com/YellowsysOrg/YellowStorm/commit/70a575e34f8ff68f3594eb12ac3e50bb7b70c0b2))
* fixed code artifact copy to clipboard ([d44ecb0](https://github.com/YellowsysOrg/YellowStorm/commit/d44ecb072e38ca334b0a3ff4bb3846cde691a168))
* fixed name generation missing model id ([ff4240d](https://github.com/YellowsysOrg/YellowStorm/commit/ff4240df1e2b633aea443cef1bc43c9d3d78a12e))
* fixed reasoning component ([b39b30e](https://github.com/YellowsysOrg/YellowStorm/commit/b39b30e47fe64cb08879a16b0edcfa87121a5280))
* fixed workspace_context ([c90f087](https://github.com/YellowsysOrg/YellowStorm/commit/c90f087da564dcab6c4fbbc593bcc113564e7dc8))
* fixed workspace_context ([6382567](https://github.com/YellowsysOrg/YellowStorm/commit/638256741d5014f6003d6e08fd6e94659cd660bb))
* implement idle timeout for stream calls to enhance error handling ([4f163b2](https://github.com/YellowsysOrg/YellowStorm/commit/4f163b2ff6b4469e62e605eb78dac67cd6112e41))
* reduce flush interval in StreamingBuffer to improve rendering performance ([ea9134b](https://github.com/YellowsysOrg/YellowStorm/commit/ea9134b177001fcfd03aaab46d33aa695e533f5a))
* remoed .env.example ([29c992d](https://github.com/YellowsysOrg/YellowStorm/commit/29c992d5bfb447b9fa97313667902e2586850741))
* set full height for conversation page container ([3ae8332](https://github.com/YellowsysOrg/YellowStorm/commit/3ae8332ce58bb87b9d7ec016f27d326994d42743))
* update conversation fetch limit to use DEFAULT_CONVERSATIONS_LIMIT unstable 0.0.1 ([c1d0d14](https://github.com/YellowsysOrg/YellowStorm/commit/c1d0d14341bf87807f7ad1a0988c5527b2d5ab0f))
* update edit condition to use canEdit for user message actions ([1eaa92f](https://github.com/YellowsysOrg/YellowStorm/commit/1eaa92f7120f436266e756da12a75b2e41cc625e))
* update layout for Plan and ChatMessageBubble components to enhance responsiveness ([47375c5](https://github.com/YellowsysOrg/YellowStorm/commit/47375c57eae59fb37ca291192fea26a0557af037))
* update privacy message in DataControlsSection to clarify data sharing policy ([36cd210](https://github.com/YellowsysOrg/YellowStorm/commit/36cd2103a272fc85fbd6904a58170efda03ab2ed))
* update section numbers and enhance troubleshooting guidance in adding-components documentation ([5ca5d7c](https://github.com/YellowsysOrg/YellowStorm/commit/5ca5d7cbb389c378aae4a39809d986bf168c4009))


### Refactoring

* fixing repo ([ea45ca5](https://github.com/YellowsysOrg/YellowStorm/commit/ea45ca5ca490b1beff6227474e35b7e066112844))
* improve conversation retrieval logic in useConversations hook ([179a196](https://github.com/YellowsysOrg/YellowStorm/commit/179a196b651790fb7693d35fa73f1ab3287cd993))
* optimized conversation scroll ([d325b89](https://github.com/YellowsysOrg/YellowStorm/commit/d325b89599b4c78d216988cc019c3b74b23c6d75))
* streamline gRPC client initialization and improve code readability ([01363ad](https://github.com/YellowsysOrg/YellowStorm/commit/01363ad4d245181a2b3b5fd50b723758347e65db))
* updated mock grpc server ([04748f5](https://github.com/YellowsysOrg/YellowStorm/commit/04748f5bc3ca3650f552425661c7a97d9a1064ed))



### Highlights
* first stable version if the YellowStorm webapp backend features the basic modules and a solid foundation for the coming evolutions