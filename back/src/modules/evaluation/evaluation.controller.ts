import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Body,
    Param,
    Headers,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiBearerAuth,
} from '@nestjs/swagger';
import { EvaluationService } from './evaluation.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';

@ApiTags('Evaluation')
@ApiBearerAuth()
@Controller('evaluation')
export class EvaluationController {
    constructor(
        private readonly evaluationService: EvaluationService,
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
    @ApiOperation({ summary: 'Create an evaluation record' })
    async launch(
        @CurrentUser() user: UserDocument,
        @Body() body: {
            agentId: string;
            datasetId: string;
            numRuns: number;
            mode: string;
            scenarioName: string;
        },
    ) {
        return this.evaluationService.launchEvaluation(
            user._id.toString(),
            body.agentId,
            body.datasetId,
            body.numRuns,
            body.mode,
            body.scenarioName,
        );
    }

    @Post('run')
    @ApiOperation({ summary: 'Run a single evaluation run and return results when done' })
    async runSingleEvaluation(
        @CurrentUser() user: UserDocument,
        @Headers('authorization') authHeader: string,
        @Body() body: {
            agentId: string;
            datasetId: string;
            mode: string;
            scenarioName: string;
            evaluationId: string;
            runIndex: number;
            judgeModel?: string;
            threshold?: number;
        },
    ) {
        return this.evaluationService.runSingleEvaluation(
            user._id.toString(),
            body.agentId,
            body.datasetId,
            body.mode,
            body.scenarioName,
            body.evaluationId,
            body.runIndex,
            authHeader,
            body.judgeModel,
            body.threshold,
        );
    }

    @Patch('results/:id/finalize')
    @ApiOperation({ summary: 'Mark an evaluation as completed or failed' })
    async finalizeEvaluation(
        @CurrentUser() user: UserDocument,
        @Param('id') id: string,
        @Body() body: { status: 'completed' | 'failed'; error?: string },
    ) {
        return this.evaluationService.finalizeEvaluation(
            user._id.toString(),
            id,
            body.status,
            body.error,
        );
    }

    @Get('results/single/:id')
    @ApiOperation({ summary: 'Get a single evaluation by ID' })
    async getEvaluationById(@Param('id') id: string) {
        return this.evaluationService.findEvaluationById(id);
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
