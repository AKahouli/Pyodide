import {
    Controller,
    Get,
    Post,
    Delete,
    Body,
    Param,
    Query,
    Headers,
    HttpCode,
    HttpStatus,
    Sse,
    MessageEvent,
    UnauthorizedException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
} from '@nestjs/swagger';
import { EvaluationService } from './evaluation.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';
import { Public } from '../auth/decorators/public.decorator';
import { JwtService } from '@nestjs/jwt';

@ApiTags('Evaluation')
@ApiBearerAuth()
@Controller('evaluation')
export class EvaluationController {
    constructor(
        private readonly evaluationService: EvaluationService,
        private readonly jwtService: JwtService,
    ) { }

    // ==========================================
    // Dataset Endpoints
    // ==========================================

    @Post('datasets')
    @ApiOperation({ summary: 'Create a new dataset' })
    async createDataset(
        @CurrentUser() user: UserDocument,
        @Body() body: { name: string; items: any[] },
    ) {
        return this.evaluationService.createDataset(user._id.toString(), body.name, body.items);
    }

    @Get('datasets')
    @ApiOperation({ summary: 'List all datasets for user' })
    async findAllDatasets(@CurrentUser() user: UserDocument) {
        return this.evaluationService.findAllDatasets(user._id.toString());
    }

    @Delete('datasets/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete a dataset' })
    async deleteDataset(@Param('id') id: string) {
        return this.evaluationService.deleteDataset(id);
    }

    // ==========================================
    // Evaluation Endpoints
    // ==========================================

    @Post('launch')
    @ApiOperation({ summary: 'Launch a batch evaluation' })
    async launch(
        @CurrentUser() user: UserDocument,
        @Headers('authorization') authHeader: string,
        @Body() body: {
            agentId: string;
            datasetId: string;
            numRuns: number;
            mode: string;
            scenarioName: string;
            threshold?: number;
        },
    ) {
        return this.evaluationService.launchEvaluation(
            user._id.toString(),
            body.agentId,
            body.datasetId,
            body.numRuns,
            body.mode,
            body.scenarioName,
            authHeader,
            body.threshold,
        );
    }

    @Post('execute')
    async executeEvaluation(
        @Headers('authorization') authHeader: string,
        @Body() body: any,
    ) {
        console.log('--- [EXEC] executeEvaluation CALLED (Sync Mode) ---');
        const tempUserId = "69cbe735e514ddfb1bd496ee"; 
        return this.evaluationService.executeEvaluationSync(
            tempUserId,
            body.agentId,
            body.datasetId,
            body.numRuns,
            body.mode,
            body.scenarioName,
            authHeader,
            body.judgeModel,
            body.threshold,
        );
    }

    @Public()
    @Sse('execute/stream')
    @ApiOperation({ summary: 'Stream evaluation results in real-time' })
    executeEvaluationStream(
        @Query('token') token: string,
        @Query('agentId') agentId: string,
        @Query('datasetId') datasetId: string,
        @Query('numRuns') numRuns: string,
        @Query('mode') mode: string,
        @Query('scenarioName') scenarioName: string,
        @Query('judgeModel') judgeModel?: string,
        @Query('threshold') threshold?: string,
        @Query('resumeId') resumeId?: string,
    ): Observable<MessageEvent> {
        // Validate Token and Extract User ID manually since we bypass the global guard for SSE
        let userId: string;
        try {
            if (!token) throw new UnauthorizedException('Token missing');
            const payload = this.jwtService.verify(token);
            userId = payload.sub;
            if (!userId) throw new UnauthorizedException('Invalid token payload');
        } catch (error: any) {
            throw new UnauthorizedException('Authentication failed for streaming: ' + error.message);
        }

        const nRuns = parseInt(numRuns || '1') || 1;
        const thresh = parseFloat(threshold || '0.7') || 0.7;

        return new Observable((observer) => {
            const run = async () => {
                try {
                    const generator = this.evaluationService.executeEvaluationStreaming(
                        userId,
                        agentId,
                        datasetId,
                        nRuns,
                        mode,
                        scenarioName,
                        token,
                        judgeModel,
                        thresh,
                        resumeId,
                    );

                    for await (const chunk of generator) {
                        observer.next({ data: chunk } as MessageEvent);
                    }
                    observer.complete();
                } catch (error: any) {
                    console.error(`--- [SSE] CONTROLLER ERROR --- ${error.message}`);
                    observer.next({ data: { type: 'error', error: error.message } } as MessageEvent);
                    observer.complete();
                }
            };
            run();
        });
    }


    @Get('results/:agentId')
    @ApiOperation({ summary: 'Get evaluation results for an agent' })
    async getResults(@Param('agentId') agentId: string) {
        return this.evaluationService.findEvaluationsByAgent(agentId);
    }

    @Delete('results/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete an evaluation result' })
    async deleteEvaluation(
        @CurrentUser() user: UserDocument,
        @Param('id') id: string
    ) {
        return this.evaluationService.deleteEvaluation(user._id.toString(), id);
    }
}
