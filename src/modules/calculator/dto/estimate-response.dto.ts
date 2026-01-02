export class EstimateResponseDto {
  box2Federal: number;
  box17State: number;
  estimatedRefund: number;
  ocrConfidence: 'high' | 'medium' | 'low';
  w2FileName: string;
  estimateId: string;
}
