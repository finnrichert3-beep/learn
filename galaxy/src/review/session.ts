import { worseGrade, type Grade } from './scheduler';

export interface SessionItem {
  /** Node index. */
  node: number;
  /** How many cards the node has. */
  cards: number;
}

export interface SessionCard {
  node: number;
  /** Index into the node's cards. */
  card: number;
}

export interface NodeResult {
  node: number;
  /** The node's grade: the weakest first answer among its cards. */
  grade: Grade;
}

/**
 * One run through a stack of flashcards.
 *
 * Every card is shown once in order. A card answered "Again" goes to the back of the
 * stack and has to be passed before the session ends, but only the first answer to
 * each card counts towards its node's grade.
 */
export class ReviewSession {
  private readonly queue: SessionCard[] = [];
  private position = 0;
  private readonly firstAnswers = new Map<string, Grade>();
  private readonly cardsPerNode = new Map<number, number>();
  private readonly completed: NodeResult[] = [];
  revealed = false;

  constructor(items: readonly SessionItem[]) {
    for (const item of items) {
      if (item.cards <= 0 || this.cardsPerNode.has(item.node)) continue;
      this.cardsPerNode.set(item.node, item.cards);
      for (let card = 0; card < item.cards; card++) this.queue.push({ node: item.node, card });
    }
  }

  /** The card being shown, or undefined when the session is over. */
  get current(): SessionCard | undefined {
    return this.queue[this.position];
  }

  get finished(): boolean {
    return this.position >= this.queue.length;
  }

  /** 1-based number of the current card, and how many there are in all (grows with each "Again"). */
  get progress(): { index: number; total: number } {
    return { index: Math.min(this.position + 1, this.queue.length), total: this.queue.length };
  }

  /** Nodes whose every card has had a first answer, in the order they were completed. */
  get results(): readonly NodeResult[] {
    return this.completed;
  }

  get nodeCount(): number {
    return this.cardsPerNode.size;
  }

  reveal(): void {
    if (!this.finished) this.revealed = true;
  }

  /**
   * Grade the current card and move on. Returns the node's result when this answer
   * completed the node (all of its cards have now been answered once), else undefined.
   */
  answer(grade: Grade): NodeResult | undefined {
    const card = this.current;
    if (!card) return undefined;
    this.position++;
    this.revealed = false;
    if (grade === 'again') this.queue.push(card);

    const key = `${card.node}:${card.card}`;
    if (this.firstAnswers.has(key)) return undefined;
    this.firstAnswers.set(key, grade);

    const total = this.cardsPerNode.get(card.node) ?? 0;
    let nodeGrade: Grade | undefined;
    for (let index = 0; index < total; index++) {
      const first = this.firstAnswers.get(`${card.node}:${index}`);
      if (first === undefined) return undefined;
      nodeGrade = nodeGrade === undefined ? first : worseGrade(nodeGrade, first);
    }
    if (nodeGrade === undefined) return undefined;
    const result = { node: card.node, grade: nodeGrade };
    this.completed.push(result);
    return result;
  }
}
